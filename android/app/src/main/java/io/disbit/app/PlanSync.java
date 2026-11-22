package io.disbit.app;

import android.content.Context;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Fetches the plan from the server and reports what the phone did with it.
 * Runs outside the accessibility service: the service itself never uses the network.
 */
final class PlanSync {
    static final String WORK = "disbit-blocking-plan";

    static void schedule(Context c) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(PlanSyncWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request);
    }
    static void cancel(Context c) { WorkManager.getInstance(c).cancelUniqueWork(WORK); }

    /** Stores a plan answer (from the web layer or from the worker) and returns the receipt state. */
    static synchronized JSONObject apply(Context c, JSONObject plan) throws Exception {
        String enrollment = plan.optString("enrollment", "");
        if (!plan.optBoolean("enabled", false)) {
            BlockingStore.clearPlan(c);
            // The server no longer accepts this phone: forget the account link entirely.
            if (!enrollment.equals("disabled")) { BlockingStore.unlink(c); cancel(c); }
            return new JSONObject().put("state", "cleared").put("enrolled", enrollment.equals("disabled"));
        }
        BlockingStore.savePlan(c, plan);
        BlockingPlan parsed = BlockingStore.plan(c);
        JSONObject out = new JSONObject().put("enrolled", true).put("planVersion", plan.optString("planVersion", ""));
        JSONArray ids = new JSONArray();
        List<BlockingPlan.Window> active = parsed == null ? java.util.Collections.emptyList() : parsed.activeAt(BlockingStore.serverNow(c));
        for (BlockingPlan.Window w : active) ids.put(w.habitId);
        String state = active.isEmpty() ? "cleared"
            : !BlockingStore.consented(c) ? "failed"
            : AppBlockingPlugin.authorized(c) && AppBlockingService.connected ? "applied" : "service_off";
        return out.put("state", state).put("habitIds", ids);
    }

    /** Background refresh. Network failure keeps the stored plan, which expires on its own. */
    static void run(Context c) {
        String base = BlockingStore.apiBase(c), token = BlockingStore.token(c), device = BlockingStore.deviceId(c);
        if (base == null || token == null || device == null || !BlockingStore.trustedApi(base)) { cancel(c); return; }
        try {
            HttpURLConnection get = open(base + "/api/blocking/plan", "GET", token, device);
            int status = get.getResponseCode();
            if (!token.equals(BlockingStore.token(c)) || !device.equals(BlockingStore.deviceId(c))) return;
            if (status == 401) { BlockingStore.unlink(c); cancel(c); return; }
            if (status != 200) return;
            JSONObject response = new JSONObject(read(get.getInputStream()));
            if (!token.equals(BlockingStore.token(c)) || !device.equals(BlockingStore.deviceId(c))) return;
            JSONObject result = apply(c, response);
            receipt(c, result);
        } catch (Exception ignored) { /* offline: the lease bounds the restriction */ }
    }

    /** Sends a receipt once per plan version and state. */
    static void receipt(Context c, JSONObject result) {
        String base = BlockingStore.apiBase(c), token = BlockingStore.token(c), device = BlockingStore.deviceId(c);
        String version = result.optString("planVersion", "");
        if (base == null || token == null || device == null || !version.matches("[0-9a-f]{16}")) return;
        String key = version + ":" + result.optString("state");
        if (key.equals(BlockingStore.prefs(c).getString("lastReceipt", ""))) return;
        try {
            JSONObject body = new JSONObject().put("planVersion", version).put("state", result.optString("state"))
                .put("habitIds", result.optJSONArray("habitIds") == null ? new JSONArray() : result.optJSONArray("habitIds"));
            HttpURLConnection post = open(base + "/api/blocking/devices/" + device + "/receipts", "POST", token, device);
            post.setDoOutput(true);
            try (OutputStream out = post.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            if (post.getResponseCode() == 201) BlockingStore.prefs(c).edit().putString("lastReceipt", key).apply();
        } catch (Exception ignored) {}
    }

    private static HttpURLConnection open(String url, String method, String token, String device) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("X-Disbit-Device", device);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        return connection;
    }
    private static String read(InputStream in) throws Exception {
        try (InputStream input = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n, total = 0;
            while ((n = input.read(buffer)) > 0) { total += n; if (total > 256 * 1024) throw new Exception("too large"); out.write(buffer, 0, n); }
            return out.toString("UTF-8");
        }
    }
    private PlanSync() {}
}
