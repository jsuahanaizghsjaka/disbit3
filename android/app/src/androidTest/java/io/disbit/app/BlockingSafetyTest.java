package io.disbit.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.provider.Settings;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Instrumentation: run on each target OEM, not a JVM claim of device safety. */
@RunWith(AndroidJUnit4.class)
public class BlockingSafetyTest {
 @Test public void ownAndMissingApplicationsCannotBeSelected() {
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertFalse(BlockingStore.selectable(c,c.getPackageName()));
  assertFalse(BlockingStore.selectable(c,"invalid.disbit.nonexistent"));
  assertFalse(BlockingStore.selectable(c,null));
 }
 @Test public void settingsDialersLaunchersAndEmergencyHandlersAreExcluded() {
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
  Intent[] intents={new Intent(Settings.ACTION_SETTINGS),new Intent(Intent.ACTION_DIAL),
    new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
    new Intent("android.intent.action.DIAL_EMERGENCY"),new Intent("android.intent.action.CALL_EMERGENCY")};
  int found=0;
  for(Intent intent:intents)for(ResolveInfo info:c.getPackageManager().queryIntentActivities(intent,PackageManager.MATCH_DEFAULT_ONLY)){
   found++;assertFalse(info.activityInfo.packageName,BlockingStore.selectable(c,info.activityInfo.packageName));
  }
  assertTrue("No protected handlers visible; fixture cannot prove exclusion",found>0);
 }
}
