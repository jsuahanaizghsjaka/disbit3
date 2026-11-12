package io.disbit.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Set;

/** Native QA control. Automatic promise penalties remain explicitly disabled. */
public class BlockingSettingsActivity extends Activity {
    private TextView status;
    private Button start;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override public void run() { updateStatus(); handler.postDelayed(this, 1000); }
    };
    @Override public void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int p = (int)(24 * getResources().getDisplayMetrics().density);
        content.setPadding(p, p, p, p); content.setBackgroundColor(0xff0b1324);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.addView(content); setContentView(scroll);
        TextView heading = label("Ограничения приложений", 26); content.addView(heading);
        content.addView(label("Проверка нативной блокировки. Автоматические ограничения за обещания ещё не включены.", 16));
        status = label("", 17); content.addView(status);
        Button permission = button("Разрешить ограничение приложений"); content.addView(permission);
        permission.setOnClickListener(v -> new AlertDialog.Builder(this)
            .setTitle("Доступ к специальным возможностям")
            .setMessage(getString(R.string.disbit_blocking_disclosure))
            .setNegativeButton("Отмена", null)
            .setPositiveButton("Согласен — открыть настройки", (d, w) -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)))
            .show());
        Button choose = button("Выбрать приложения"); content.addView(choose); choose.setOnClickListener(v -> chooseApps());
        start = button("Проверить блокировку на 15 минут"); content.addView(start);
        start.setOnClickListener(v -> {
            if (!AppBlockingPlugin.authorized(this) || BlockingStore.selected(this).isEmpty()) { updateStatus(); return; }
            new AlertDialog.Builder(this).setTitle("Включить на 15 минут?")
                .setMessage("Выбранные приложения будут недоступны. Ограничение можно снять здесь в любой момент.")
                .setNegativeButton("Отмена", null).setPositiveButton("Включить", (d, w) -> {
                    long now = System.currentTimeMillis();
                    BlockingStore.prefs(this).edit().putLong("start", now).putLong("end", now + 900000).commit(); updateStatus();
                }).show();
        });
        Button stop = button("Снять ограничение"); content.addView(stop);
        stop.setOnClickListener(v -> { BlockingStore.stop(this); updateStatus(); });
        Button settings = button("Настройки энергосбережения"); content.addView(settings);
        settings.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)));
        content.addView(label("Android может остановить службу при энергосбережении. После перезагрузки проверьте её состояние. Отключение разрешения прекращает блокировку; это не денежный штраф.", 16));
        Button done = button("Вернуться в Disbit"); content.addView(done); done.setOnClickListener(v -> finish());
    }
    private TextView label(String text, int size) {
        TextView v = new TextView(this); v.setText(text); v.setTextSize(size); v.setTextColor(0xfff4f7ff); v.setPadding(0, 12, 0, 12); return v;
    }
    private Button button(String title) { Button b = new Button(this); b.setText(title); b.setMinHeight(56); return b; }
    private void updateStatus() {
        boolean granted = AppBlockingPlugin.authorized(this);
        boolean active = granted && AppBlockingService.connected && BlockingStore.active(this);
        int count = BlockingStore.selected(this).size();
        PowerManager power = getSystemService(PowerManager.class);
        String end = active ? "\nДо " + android.text.format.DateFormat.getTimeFormat(this).format(
            new java.util.Date(BlockingStore.prefs(this).getLong("end", 0))) : "";
        status.setText((granted ? "Разрешение включено" : "Нет разрешения — блокировка не работает")
            + (granted && !AppBlockingService.connected ? "\nСлужба не подключена. Выключите и включите доступ в настройках Android." : "")
            + "\nВыбрано приложений: " + count + "\n" + (active ? "Ограничение активно" : "Ограничение не активно") + end
            + (power.isPowerSaveMode() ? "\nЭнергосбережение включено" : ""));
        start.setEnabled(granted && AppBlockingService.connected && count > 0 && !active);
    }
    private void chooseApps() {
        if (BlockingStore.active(this)) {
            new AlertDialog.Builder(this).setMessage("Сначала снимите активное ограничение.").setPositiveButton("Понятно", null).show(); return;
        }
        ArrayList<ResolveInfo> candidates = new ArrayList<>(getPackageManager().queryIntentActivities(
            new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0));
        candidates.sort(Comparator.comparing(r -> r.loadLabel(getPackageManager()).toString()));
        ArrayList<String> packages = new ArrayList<>(); ArrayList<String> labels = new ArrayList<>();
        for (ResolveInfo r : candidates) {
            String pkg = r.activityInfo.packageName;
            if (BlockingStore.selectable(this, pkg) && !packages.contains(pkg)) {
                packages.add(pkg); labels.add(r.loadLabel(getPackageManager()).toString());
            }
        }
        Set<String> selection = new HashSet<>(BlockingStore.selected(this)); selection.retainAll(packages);
        boolean[] checked = new boolean[packages.size()];
        for (int i = 0; i < checked.length; i++) checked[i] = selection.contains(packages.get(i));
        new AlertDialog.Builder(this).setTitle("Приложения — системные исключены")
            .setMultiChoiceItems(labels.toArray(new String[0]), checked, (d, which, value) -> {
                if (value) selection.add(packages.get(which)); else selection.remove(packages.get(which));
            }).setNegativeButton("Отмена", null).setPositiveButton("Сохранить", (d, w) -> {
                BlockingStore.prefs(this).edit().putStringSet("packages", selection).commit(); updateStatus();
            }).show();
    }
    @Override protected void onResume() { super.onResume(); handler.post(tick); }
    @Override protected void onPause() { handler.removeCallbacks(tick); super.onPause(); }
}
