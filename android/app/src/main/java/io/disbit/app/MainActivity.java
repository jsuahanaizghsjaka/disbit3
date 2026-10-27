package io.disbit.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(Color.rgb(11, 19, 36));
        if (Build.VERSION.SDK_INT < 35) {
            getWindow().setStatusBarColor(Color.rgb(11, 19, 36));
            getWindow().setNavigationBarColor(Color.rgb(11, 19, 36));
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightNavigationBars(false);
        }
    }
}
