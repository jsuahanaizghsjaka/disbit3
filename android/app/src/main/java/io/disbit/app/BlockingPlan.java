package io.disbit.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * A restriction plan confirmed by the server. Pure logic, no Android types:
 * covered by unit tests. Everything fails open — a plan that is expired,
 * malformed or too long never restricts anything.
 */
public final class BlockingPlan {
    /** The server lease is 2 hours; a little slack for transport, never more. */
    public static final long MAX_LEASE = 2L * 60 * 60 * 1000 + 5 * 60 * 1000;

    public static final class Window {
        public final String habitId, name;
        public final long start, end;
        public final Set<String> apps;
        public Window(String habitId, String name, long start, long end, Set<String> apps) {
            this.habitId = habitId; this.name = name == null ? "" : name;
            this.start = start; this.end = end;
            this.apps = Collections.unmodifiableSet(new HashSet<>(apps));
        }
    }

    public final String version;
    public final long serverNow, validUntil;
    public final List<Window> windows;

    public BlockingPlan(String version, long serverNow, long validUntil, List<Window> windows) {
        this.version = version == null ? "" : version;
        this.serverNow = serverNow;
        // A lease longer than the server ever grants is cut, not trusted.
        this.validUntil = Math.min(validUntil, serverNow + MAX_LEASE);
        List<Window> kept = new ArrayList<>();
        for (Window w : windows) {
            if (w.habitId != null && !w.habitId.isEmpty() && BlockingWindow.valid(w.start, w.end) && !w.apps.isEmpty()) kept.add(w);
        }
        this.windows = Collections.unmodifiableList(kept);
    }

    /** Windows restricting at the server instant {@code now}. */
    public List<Window> activeAt(long now) {
        List<Window> out = new ArrayList<>();
        if (now < serverNow - MAX_LEASE || now >= validUntil) return out;
        for (Window w : windows) if (BlockingWindow.active(w.start, w.end, now)) out.add(w);
        return out;
    }

    /** The first active window restricting {@code pkg}, or null. */
    public Window restricting(String pkg, long now) {
        if (pkg == null) return null;
        for (Window w : activeAt(now)) if (w.apps.contains(pkg)) return w;
        return null;
    }

    /** Next server instant after {@code now} at which the result of {@link #activeAt} may change; 0 if none. */
    public long nextChange(long now) {
        long next = validUntil > now ? validUntil : 0;
        for (Window w : windows) {
            if (w.start > now && (next == 0 || w.start < next)) next = w.start;
            if (w.end > now && (next == 0 || w.end < next)) next = w.end;
        }
        return next;
    }

    /**
     * Server time estimate. Within one boot the monotonic clock is used, so moving
     * the phone's clock does not move the restriction. After a reboot only the wall
     * clock remains; the short lease bounds the damage either way.
     */
    public static long serverTime(long serverNowAtReceipt, long wallAtReceipt, long elapsedAtReceipt, int bootAtReceipt,
                                  long wallNow, long elapsedNow, int bootNow) {
        if (bootAtReceipt >= 0 && bootAtReceipt == bootNow && elapsedNow >= elapsedAtReceipt) {
            return serverNowAtReceipt + (elapsedNow - elapsedAtReceipt);
        }
        return wallNow + (serverNowAtReceipt - wallAtReceipt);
    }
}
