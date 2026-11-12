package io.disbit.app;

/** Absolute instants: timezone changes do not extend a running restriction. */
public final class BlockingWindow {
    public static final long MAX_DURATION = 24L * 60 * 60 * 1000;
    public static boolean valid(long start, long end) {
        return start > 0 && end > start && end - start <= MAX_DURATION;
    }
    public static boolean active(long start, long end, long now) {
        return valid(start, end) && now >= start && now < end;
    }
    private BlockingWindow() {}
}
