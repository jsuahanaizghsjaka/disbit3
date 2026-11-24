package io.disbit.app;

import org.junit.Test;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import static org.junit.Assert.*;

public class BlockingPlanTest {
    private static final long H = 3600_000L, NOW = 1_800_000_000_000L;
    private static BlockingPlan.Window w(String id, long start, long end, String... apps) {
        return new BlockingPlan.Window(id, id, start, end, new HashSet<>(Arrays.asList(apps)));
    }
    @Test public void restrictsOnlyListedAppsInsideWindowAndLease() {
        BlockingPlan plan = new BlockingPlan("v", NOW, NOW + 2 * H,
            Collections.singletonList(w("a", NOW - H, NOW + 10 * H, "com.instagram.android")));
        assertNotNull(plan.restricting("com.instagram.android", NOW));
        assertNull(plan.restricting("org.telegram.messenger", NOW));
        assertNull(plan.restricting("com.instagram.android", NOW + 2 * H));   // lease over: fail open
        assertNull(plan.restricting(null, NOW));
    }
    @Test public void excessiveLeaseIsCutAndBadWindowsDropped() {
        BlockingPlan plan = new BlockingPlan("v", NOW, NOW + 48 * H, Arrays.asList(
            w("long", NOW - H, NOW + 30 * H, "x.y"), w("", NOW - H, NOW + H, "x.y"), w("empty", NOW - H, NOW + H)));
        assertEquals(NOW + BlockingPlan.MAX_LEASE, plan.validUntil);
        assertTrue(plan.windows.isEmpty());
    }
    @Test public void nextChangeIsEarliestBoundary() {
        BlockingPlan plan = new BlockingPlan("v", NOW, NOW + 2 * H,
            Collections.singletonList(w("a", NOW - H, NOW + H, "x.y")));
        assertEquals(NOW + H, plan.nextChange(NOW));
        assertEquals(NOW + 2 * H, plan.nextChange(NOW + H));
        assertEquals(0, plan.nextChange(NOW + 2 * H));
    }
    @Test public void clockChangesWithinOneBootDoNotMoveServerTime() {
        // wall clock jumped forward a day, monotonic clock moved 10 minutes
        long t = BlockingPlan.serverTime(NOW, NOW - 5000, 1000, 7, NOW + 24 * H, 1000 + 600_000, 7);
        assertEquals(NOW + 600_000, t);
        // after a reboot only the wall clock (with the measured offset) remains
        long r = BlockingPlan.serverTime(NOW, NOW - 5000, 1000, 7, NOW + H, 50, 8);
        assertEquals(NOW + H + 5000, r);
    }
}
