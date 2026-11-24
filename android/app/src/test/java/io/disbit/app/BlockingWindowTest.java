package io.disbit.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class BlockingWindowTest {
    @Test public void boundariesDoNotExtendRestriction() {
        assertFalse(BlockingWindow.active(1000, 2000, 999));
        assertTrue(BlockingWindow.active(1000, 2000, 1000));
        assertTrue(BlockingWindow.active(1000, 2000, 1999));
        assertFalse(BlockingWindow.active(1000, 2000, 2000));
    }
    @Test public void invalidOrExcessiveWindowsNeverBlock() {
        assertFalse(BlockingWindow.active(0, 0, 0));
        assertFalse(BlockingWindow.valid(2000, 1000));
        assertFalse(BlockingWindow.valid(1000, 1001 + BlockingWindow.MAX_DURATION));
        assertTrue(BlockingWindow.valid(1000, 1000 + BlockingWindow.MAX_DURATION));
    }
}
