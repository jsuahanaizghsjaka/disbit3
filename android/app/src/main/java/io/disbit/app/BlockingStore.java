package io.disbit.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.provider.Settings;
import java.util.HashSet;
import java.util.Set;

final class BlockingStore {
    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("disbit_blocking", Context.MODE_PRIVATE);
    }
    static boolean active(Context c) {
        SharedPreferences p = prefs(c);
        return BlockingWindow.active(p.getLong("start", 0), p.getLong("end", 0), System.currentTimeMillis());
    }
    static void stop(Context c) {
        prefs(c).edit().remove("start").remove("end").commit();
    }
    static Set<String> selected(Context c) {
        return new HashSet<>(prefs(c).getStringSet("packages", new HashSet<>()));
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
                new Intent(Intent.ACTION_DIAL), new Intent(Settings.ACTION_SETTINGS)
            };
            for (Intent intent : protectedIntents) {
                for (ResolveInfo r : pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)) {
                    if (pkg.equals(r.activityInfo.packageName)) return false;
                }
            }
            android.view.inputmethod.InputMethodManager imm =
                (android.view.inputmethod.InputMethodManager)c.getSystemService(Context.INPUT_METHOD_SERVICE);
            for (android.view.inputmethod.InputMethodInfo input : imm.getInputMethodList()) {
                if (pkg.equals(input.getPackageName())) return false;
            }
            return true;
        } catch (PackageManager.NameNotFoundException e) { return false; }
    }
}
