package io.disbit.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class PlanSyncWorker extends Worker {
    public PlanSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }
    @NonNull @Override public Result doWork() {
        PlanSync.run(getApplicationContext());
        return Result.success();
    }
}
