import Capacitor

class DisbitBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppBlockingPlugin())
    }
}
