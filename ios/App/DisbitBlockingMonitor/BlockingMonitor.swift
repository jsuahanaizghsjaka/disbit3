import DeviceActivity
import Foundation

@available(iOS 16.0, *)
final class BlockingMonitor: DeviceActivityMonitor {
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        BlockingShared.reconcile()
    }
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        // A delayed callback from an earlier interval must not clear a newer one.
        if BlockingShared.endsAt <= Date().timeIntervalSince1970 { BlockingShared.clear() }
    }
}
