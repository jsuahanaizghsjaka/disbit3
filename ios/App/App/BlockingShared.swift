import Foundation
import FamilyControls
import ManagedSettings

@available(iOS 16.0, *)
enum BlockingShared {
    static let group = "group.io.disbit.app.blocking"
    static let store = ManagedSettingsStore(named: .init("disbit"))
    static var defaults: UserDefaults? { UserDefaults(suiteName: group) }
    static var endsAt: Double { defaults?.double(forKey: "endsAt") ?? 0 }
    static var selection: FamilyActivitySelection {
        guard let data = defaults?.data(forKey: "selection"),
              let value = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else {
            return FamilyActivitySelection()
        }
        return value
    }
    static func clear() {
        store.clearAllSettings()
        defaults?.removeObject(forKey: "endsAt")
    }
    static func reconcile() {
        guard AuthorizationCenter.shared.authorizationStatus == .approved,
              endsAt > Date().timeIntervalSince1970 else { clear(); return }
        let tokens = selection.applicationTokens
        let desired = tokens.isEmpty ? nil : tokens
        if store.shield.applications != desired { store.shield.applications = desired }
    }
}
