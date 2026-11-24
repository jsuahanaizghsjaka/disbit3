package io.disbit.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;
import java.net.URI;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** App-private storage, excluded from backup and device transfer (see res/xml). */
final class BlockingStore {
    /** Must match BLOCKING_CONSENT_VERSION on the server; bump with the disclosure text. */
    static final int CONSENT_VERSION = 2;

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("disbit_blocking", Context.MODE_PRIVATE);
    }
    static boolean consented(Context c) {
        return prefs(c).getInt("disclosureVersion", 0) == CONSENT_VERSION;
    }
    /** Manual QA window from the native settings screen. */
    static boolean active(Context c) {
        SharedPreferences p = prefs(c);
        return consented(c) && BlockingWindow.active(p.getLong("start", 0), p.getLong("end", 0), System.currentTimeMillis());
    }
    static void stop(Context c) {
        prefs(c).edit().remove("start").remove("end").commit();
    }
    static Set<String> selected(Context c) {
        return new HashSet<>(prefs(c).getStringSet("packages", new HashSet<>()));
    }

    static synchronized String installationId(Context c) {
        String id = prefs(c).getString("installationId", null);
        if (id == null) {
            byte[] bytes = new byte[24];
            new SecureRandom().nextBytes(bytes);
            id = Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            prefs(c).edit().putString("installationId", id).commit();
        }
        return id;
    }

    // ---- automatic plan ----

    /** Only our own HTTPS hosts may ever receive the account token. */
    static boolean trustedApi(String base) {
        try {
            URI uri = new URI(base);
            String host = uri.getHost();
            return "https".equals(uri.getScheme()) && host != null && uri.getPort() == -1
                && (host.equals("disbit.ru") || host.endsWith(".disbit.ru"))
                && (uri.getPath() == null || uri.getPath().isEmpty() || uri.getPath().equals("/"));
        } catch (Exception e) { return false; }
    }
    static void saveLink(Context c, String apiBase, String token, String deviceId) {
        prefs(c).edit().putString("apiBase", apiBase).putString("token", token).putString("deviceId", deviceId).commit();
    }
    static String apiBase(Context c) { return prefs(c).getString("apiBase", null); }
    static String token(Context c) { return prefs(c).getString("token", null); }
    static String deviceId(Context c) { return prefs(c).getString("deviceId", null); }

    static void savePlan(Context c, JSONObject plan) {
        prefs(c).edit().putString("plan", plan.toString())
            .putLong("planWall", System.currentTimeMillis())
            .putLong("planElapsed", SystemClock.elapsedRealtime())
            .putInt("planBoot", bootCount(c)).commit();
        cached = null;
    }
    static void clearPlan(Context c) {
        prefs(c).edit().remove("plan").remove("planWall").remove("planElapsed").remove("planBoot").commit();
        cached = null;
    }
    /** Logout, account switch or revoked enrolment: forget everything tied to the account. */
    static void unlink(Context c) {
        prefs(c).edit().remove("apiBase").remove("token").remove("deviceId")
            .remove("lastReceipt").commit();
        clearPlan(c);
    }

    private static String cachedRaw;
    private static BlockingPlan cached;
    static synchronized BlockingPlan plan(Context c) {
        String raw = prefs(c).getString("plan", null);
        if (raw == null) { cachedRaw = null; cached = null; return null; }
        if (raw.equals(cachedRaw) && cached != null) return cached;
        try { cached = parse(new JSONObject(raw)); cachedRaw = raw; }
        catch (Exception e) { cached = null; cachedRaw = null; }
        return cached;
    }
    static BlockingPlan parse(JSONObject json) throws Exception {
        if (!json.optBoolean("enabled", false)) return null;
        List<BlockingPlan.Window> windows = new ArrayList<>();
        JSONArray list = json.optJSONArray("windows");
        for (int i = 0; list != null && i < list.length(); i++) {
            JSONObject w = list.getJSONObject(i);
            Set<String> apps = new HashSet<>();
            JSONArray a = w.optJSONArray("apps");
            for (int j = 0; a != null && j < a.length(); j++) apps.add(a.getString(j));
            windows.add(new BlockingPlan.Window(w.optString("habitId", ""), w.optString("name", ""),
                w.optLong("startsAt", 0), w.optLong("endsAt", 0), apps));
        }
        return new BlockingPlan(json.optString("planVersion", ""), json.getLong("serverNow"), json.getLong("validUntil"), windows);
    }
    static long serverNow(Context c) {
        SharedPreferences p = prefs(c);
        BlockingPlan plan = plan(c);
        if (plan == null) return System.currentTimeMillis();
        return BlockingPlan.serverTime(plan.serverNow, p.getLong("planWall", 0), p.getLong("planElapsed", 0), p.getInt("planBoot", -1),
            System.currentTimeMillis(), SystemClock.elapsedRealtime(), bootCount(c));
    }
    static BlockingPlan.Window restricting(Context c, String pkg) {
        BlockingPlan plan = plan(c);
        if (plan == null || !consented(c) || deviceId(c) == null) return null;
        return plan.restricting(pkg, serverNow(c));
    }
    /** Milliseconds until the plan may change, or 0. */
    static long nextPlanChange(Context c) {
        BlockingPlan plan = plan(c);
        if (plan == null) return 0;
        long now = serverNow(c), next = plan.nextChange(now);
        return next > now ? next - now : 0;
    }
    static int bootCount(Context c) {
        try { return Settings.Global.getInt(c.getContentResolver(), Settings.Global.BOOT_COUNT); }
        catch (Exception e) { return -1; }
    }

    // Exclude ALL system apps, plus default home/dialer/settings/input methods.
    // Package selection never relies on app labels supplied by the web layer.
    static boolean selectable(Context c, String pkg) {
        if (pkg == null || pkg.equals(c.getPackageName())) return false;
        PackageManager pm = c.getPackageManager();
        try {
            ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
            if ((info.flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0) return false;
            if (pm.getLaunchIntentForPackage(pkg) == null) return false;
            Intent[] protectedIntents = {
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
                new Intent(Intent.ACTION_DIAL), new Intent(Settings.ACTION_SETTINGS),
                new Intent("android.intent.action.DIAL_EMERGENCY"),
                new Intent("android.intent.action.CALL_EMERGENCY")
            };
            for (Intent intent : protectedIntents) {
                for (ResolveInfo r : pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)) {
                    if (pkg.equals(r.activityInfo.packageName)) return false;
                }
            }
            android.view.inputmethod.InputMethodManager imm =
                (android.view.inputmethod.InputMethodManager)c.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm == null) return false;
            for (android.view.inputmethod.InputMethodInfo input : imm.getInputMethodList()) {
                if (pkg.equals(input.getPackageName())) return false;
            }
            return true;
        } catch (PackageManager.NameNotFoundException | SecurityException e) { return false; }
    }
}
