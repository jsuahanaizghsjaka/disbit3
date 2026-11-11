package io.disbit.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** No window contents, text, gestures, screenshots or network access. */
public class AppBlockingService extends AccessibilityService implements SharedPreferences.OnSharedPreferenceChangeListener {
    static volatile boolean connected = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LinearLayout shield;
    private String foreground = "";
    private final Runnable refresh = () -> reconcile();

    @Override protected void onServiceConnected() {
        connected = true;
        BlockingStore.prefs(this).registerOnSharedPreferenceChangeListener(this);
        reconcile();
    }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || event.getPackageName() == null) return;
        String pkg = event.getPackageName().toString();
        // Our own overlay produces events too; do not hide it because of those.
        if (pkg.equals(getPackageName()) && shield != null) return;
        foreground = pkg;
        reconcile();
    }
    private void reconcile() {
        handler.removeCallbacks(refresh);
        if (BlockingStore.active(this) && BlockingStore.selected(this).contains(foreground)
                && BlockingStore.selectable(this, foreground)) {
            showShield();
        } else hideShield();
        long now = System.currentTimeMillis();
        long start = BlockingStore.prefs(this).getLong("start", 0);
        long end = BlockingStore.prefs(this).getLong("end", 0);
        long next = start > now ? start : end;
        if (next > now) handler.postDelayed(refresh, Math.min(next - now, 60000));
    }
    private void showShield() {
        if (shield != null) return;
        shield = new LinearLayout(this);
        shield.setOrientation(LinearLayout.VERTICAL);
        shield.setGravity(Gravity.CENTER);
        int padding = (int)(24 * getResources().getDisplayMetrics().density);
        shield.setPadding(padding, padding, padding, padding);
        shield.setBackgroundColor(0xff0b1324);
        TextView title = new TextView(this);
        title.setText("Время для обещания"); title.setTextSize(28); title.setTextColor(0xfff4f7ff);
        shield.addView(title);
        TextView detail = new TextView(this);
        detail.setText("Это приложение временно ограничено в Disbit. Телефон и системные настройки доступны.");
        detail.setTextSize(18); detail.setTextColor(0xffaebbd1); detail.setPadding(0, padding, 0, padding);
        shield.addView(detail);
        Button open = new Button(this); open.setText("Открыть Disbit");
        open.setOnClickListener(v -> {
            hideShield(); foreground = "";
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        }); shield.addView(open);
        Button home = new Button(this); home.setText("На главный экран телефона");
        home.setOnClickListener(v -> { performGlobalAction(GLOBAL_ACTION_HOME); hideShield(); foreground = ""; });
        shield.addView(home);
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.OPAQUE);
        try { getSystemService(WindowManager.class).addView(shield, params); }
        catch (RuntimeException e) { shield = null; }
    }
    private void hideShield() {
        if (shield != null) {
            try { getSystemService(WindowManager.class).removeView(shield); } catch (IllegalArgumentException ignored) {}
            shield = null;
        }
    }
    @Override public void onSharedPreferenceChanged(SharedPreferences p, String key) { handler.post(refresh); }
    @Override public void onInterrupt() { hideShield(); }
    @Override public void onDestroy() {
        connected = false;
        handler.removeCallbacksAndMessages(null); hideShield();
        BlockingStore.prefs(this).unregisterOnSharedPreferenceChangeListener(this);
        super.onDestroy();
    }
    @Override public boolean onUnbind(Intent intent) {
        connected = false;
        handler.removeCallbacksAndMessages(null);
        hideShield();
        return super.onUnbind(intent);
    }
}
