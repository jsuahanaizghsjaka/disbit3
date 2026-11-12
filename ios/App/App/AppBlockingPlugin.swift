import Capacitor
import SwiftUI
import Combine
import FamilyControls
import DeviceActivity
import ManagedSettings

@objc(AppBlockingPlugin)
public class AppBlockingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppBlockingPlugin"
    public let jsName = "AppBlocking"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard #available(iOS 16.0, *) else { call.reject("Нужна iOS 16 или новее"); return }
            guard let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else {
                call.reject("Закройте открытое окно и повторите"); return
            }
            let controller = UIHostingController(rootView: BlockingSettingsView())
            presenter.present(controller, animated: true)
            call.resolve()
        }
    }
    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard #available(iOS 16.0, *) else { call.resolve(["authorized": false, "active": false, "supported": false]); return }
            BlockingShared.reconcile()
            call.resolve([
                "authorized": AuthorizationCenter.shared.authorizationStatus == .approved,
                "active": BlockingShared.endsAt > Date().timeIntervalSince1970,
                "selectedCount": BlockingShared.selection.applicationTokens.count,
                "endsAt": BlockingShared.endsAt * 1000,
                "automaticPenalties": false
            ])
        }
    }
}

@available(iOS 16.0, *)
struct BlockingSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var selection = BlockingShared.selection
    @State private var picker = false
    @State private var message = ""
    @State private var busy = false
    @State private var authorized = false
    @State private var active = false
    @State private var confirmStart = false
    private let activity = DeviceActivityName("disbit.restriction")
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Нативная проверка. Автоматические ограничения за обещания ещё не включены.")
                    Text(authorized ? "Разрешение включено" : "Нет разрешения Screen Time")
                    Text(active ? "Ограничение активно" : "Ограничение не активно")
                    if active { Text(Date(timeIntervalSince1970: BlockingShared.endsAt), style: .time) }
                }
                Section("Разрешение") {
                    Text("Disbit использует Screen Time, чтобы закрывать выбранные приложения. Список хранится на устройстве в виде защищённых токенов Apple и не отправляется на сервер. Доступ можно отозвать в настройках iOS.")
                    Button("Разрешить Screen Time") { authorize() }.disabled(busy || authorized)
                }
                Section("Приложения") {
                    Button("Выбрать приложения (\(selection.applicationTokens.count))") { picker = true }
                        .disabled(!authorized || active)
                    Text("Выберите отдельные приложения. Категории и сайты в этой версии не ограничиваются.")
                    Button("Проверить блокировку на 16 минут") { confirmStart = true }
                        .disabled(!authorized || active || selection.applicationTokens.isEmpty || busy)
                    Button("Снять ограничение", role: .destructive) {
                        BlockingShared.clear()
                        DeviceActivityCenter().stopMonitoring([activity])
                        refresh()
                    }
                }
                if !message.isEmpty { Section { Text(message).accessibilityLabel(message) } }
                Section { Text("Для работы требуется разрешение Family Controls у приложения и расширения. Отзыв доступа прекращает ограничение. В симуляторе реальную блокировку проверить нельзя.") }
            }
            .navigationTitle("Ограничения")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
            .familyActivityPicker(isPresented: $picker, selection: $selection)
            .onChange(of: picker) { showing in
                if !showing {
                    do { BlockingShared.defaults?.set(try JSONEncoder().encode(selection), forKey: "selection") }
                    catch { message = "Не удалось сохранить выбор приложений" }
                }
            }
            .confirmationDialog("Ограничить выбранные приложения на 16 минут?", isPresented: $confirmStart, titleVisibility: .visible) {
                Button("Включить ограничение") { start() }
                Button("Отмена", role: .cancel) {}
            }
            .onAppear { refresh() }
            .onChange(of: scenePhase) { phase in if phase == .active { refresh() } }
            .onReceive(timer) { _ in refresh() }
        }
    }
    private func refresh() {
        BlockingShared.reconcile()
        authorized = AuthorizationCenter.shared.authorizationStatus == .approved
        active = authorized && BlockingShared.endsAt > Date().timeIntervalSince1970
    }
    private func authorize() {
        busy = true
        Task { @MainActor in
            defer { busy = false; refresh() }
            do { try await AuthorizationCenter.shared.requestAuthorization(for: .individual); message = "" }
            catch { message = "Доступ не предоставлен. Проверьте разрешение Screen Time и подпись приложения." }
        }
    }
    private func start() {
        guard authorized, !selection.applicationTokens.isEmpty,
              let defaults = BlockingShared.defaults else { message = "Нет разрешения или общей группы приложения"; return }
        let end = Date().addingTimeInterval(16 * 60)
        let calendar = Calendar.current
        let components: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
        do {
            defaults.set(try JSONEncoder().encode(selection), forKey: "selection")
            let schedule = DeviceActivitySchedule(
                intervalStart: calendar.dateComponents(components, from: Date()),
                intervalEnd: calendar.dateComponents(components, from: end), repeats: false)
            try DeviceActivityCenter().startMonitoring(activity, during: schedule)
            defaults.set(end.timeIntervalSince1970, forKey: "endsAt")
            BlockingShared.reconcile()
            message = "Ограничение включено. Его можно снять на этом экране."
        } catch {
            BlockingShared.clear()
            DeviceActivityCenter().stopMonitoring([activity])
            message = "Не удалось запустить ограничение. Проверьте Family Controls и расширение Device Activity."
        }
        refresh()
    }
}
