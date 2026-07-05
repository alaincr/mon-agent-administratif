import UIKit
import Capacitor

// Sous-classe du contrôleur Capacitor : enregistre les plugins EMBARQUÉS dans l'app (non listés
// dans capacitor.config.json, donc pas auto-découverts). Hook officiel = capacitorDidLoad().
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeLLMPlugin())
    }
}
