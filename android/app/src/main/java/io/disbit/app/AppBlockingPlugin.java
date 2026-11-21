package io.disbit.app;

import android.content.Intent;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.view.accessibility.AccessibilityManager;
import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppBlocking")
public class AppBlockingPlugin extends Plugin {
    static boolean authorized(Context c) {
        AccessibilityManager manager = c.getSystemService(AccessibilityManager.class);
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
        JSObject result = new JSObject();
        boolean permission = authorized(getContext());
        result.put("authorized", permission);
        result.put("serviceConnected", AppBlockingService.connected);
        result.put("active", permission && AppBlockingService.connected && BlockingStore.active(getContext()));
        result.put("selectedCount", BlockingStore.selected(getContext()).size());
        result.put("endsAt", BlockingStore.prefs(getContext()).getLong("end", 0));
        result.put("automaticPenalties", false);
        call.resolve(result);
    }
}
