package io.disbit.app;

import android.content.Intent;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.view.accessibility.AccessibilityManager;
import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONObject;

@CapacitorPlugin(name = "AppBlocking")
public class AppBlockingPlugin extends Plugin {
    static boolean authorized(Context c) {
        AccessibilityManager manager = c.getSystemService(AccessibilityManager.class);
        if (manager == null) return false;
        for (AccessibilityServiceInfo s : manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
            if (s.getResolveInfo().serviceInfo.packageName.equals(c.getPackageName())
                && s.getResolveInfo().serviceInfo.name.equals(AppBlockingService.class.getName())) return true;
        }
        return false;
    }
    @PluginMethod public void openSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().startActivity(new Intent(getActivity(), BlockingSettingsActivity.class));
            call.resolve();
        });
    }
    @PluginMethod public void getStatus(PluginCall call) {
        Context c = getContext();
        JSObject result = new JSObject();
        boolean permission = authorized(c);
        BlockingPlan plan = BlockingStore.plan(c);
        int windows = plan == null ? 0 : plan.activeAt(BlockingStore.serverNow(c)).size();
        result.put("authorized", permission);
        result.put("serviceConnected", AppBlockingService.connected);
        result.put("active", permission && AppBlockingService.connected && BlockingStore.active(c));
        result.put("selectedCount", BlockingStore.selected(c).size());
        result.put("endsAt", BlockingStore.prefs(c).getLong("end", 0));
        result.put("consentVersion", BlockingStore.prefs(c).getInt("disclosureVersion", 0));
        result.put("requiredConsentVersion", BlockingStore.CONSENT_VERSION);
        result.put("linked", BlockingStore.deviceId(c) != null);
        result.put("planWindows", windows);
        result.put("automaticPenalties", BlockingStore.deviceId(c) != null && plan != null);
        call.resolve(result);
    }
    /** Random per-install id for enrolment; reinstalling the app produces a new one. */
    @PluginMethod public void getInstallation(PluginCall call) {
        Context c = getContext();
        JSObject result = new JSObject();
        result.put("installationId", BlockingStore.installationId(c));
        result.put("consentVersion", BlockingStore.prefs(c).getInt("disclosureVersion", 0));
        result.put("requiredConsentVersion", BlockingStore.CONSENT_VERSION);
        result.put("authorized", authorized(c));
        result.put("serviceConnected", AppBlockingService.connected);
        result.put("label", (Build.MANUFACTURER + " " + Build.MODEL).trim());
        try { result.put("appVersion", c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName); }
        catch (PackageManager.NameNotFoundException e) { result.put("appVersion", ""); }
        call.resolve(result);
    }
    /** Launchable user apps that may be restricted, with their labels. System apps are never listed. */
    @PluginMethod public void listApps(PluginCall call) {
        new Thread(() -> {
            Context c = getContext();
            PackageManager pm = c.getPackageManager();
            List<ResolveInfo> candidates = new ArrayList<>(pm.queryIntentActivities(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0));
            candidates.sort(Comparator.comparing(r -> r.loadLabel(pm).toString().toLowerCase()));
            Set<String> seen = new HashSet<>();
            JSArray apps = new JSArray();
            for (ResolveInfo r : candidates) {
                String pkg = r.activityInfo.packageName;
                if (seen.add(pkg) && BlockingStore.selectable(c, pkg)) {
                    JSObject app = new JSObject();
                    app.put("package", pkg);
                    app.put("label", r.loadLabel(pm).toString());
                    apps.put(app);
                }
            }
            JSObject result = new JSObject();
            result.put("apps", apps);
            call.resolve(result);
        }).start();
    }
    /**
     * Applies a plan answer from GET /api/blocking/plan and keeps the account link
     * so the phone can refresh in the background. Returns the receipt state.
     */
    @PluginMethod public void applyPlan(PluginCall call) {
        Context c = getContext();
        JSObject plan = call.getObject("plan");
        String apiBase = call.getString("apiBase"), token = call.getString("token"), deviceId = call.getString("deviceId");
        if (plan == null || apiBase == null || token == null || deviceId == null || !BlockingStore.trustedApi(apiBase)
                || !deviceId.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) {
            call.reject("invalid_plan"); return;
        }
        try {
            // A different account on this phone: the previous one's plan must not survive.
            if (!token.equals(BlockingStore.token(c))) BlockingStore.unlink(c);
            BlockingStore.saveLink(c, apiBase, token, deviceId);
            JSONObject result = PlanSync.apply(c, plan);
            if (BlockingStore.deviceId(c) != null) PlanSync.schedule(c);
            call.resolve(JSObject.fromJSONObject(result));
        } catch (Exception e) {
            BlockingStore.clearPlan(c);
            call.reject("invalid_plan");
        }
    }
    /** Logout or disconnect: lift everything and forget the account link. */
    @PluginMethod public void clearPlan(PluginCall call) {
        BlockingStore.unlink(getContext());
        PlanSync.cancel(getContext());
        call.resolve();
    }
}
