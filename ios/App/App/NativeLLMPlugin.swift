import Foundation
import Capacitor
#if canImport(FoundationModels)
import FoundationModels
#endif

// Assistant IA NATIF (iOS 26+) via Apple FoundationModels : le modèle est fourni par l'OS
// (aucun poids à bundler), tourne sur le Neural Engine, hors-ligne. Remplace WebLLM (WebGPU),
// indisponible dans le WKWebView. Exposé au JS sous window.Capacitor.Plugins.NativeLLM.
@objc(NativeLLMPlugin)
public class NativeLLMPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeLLMPlugin"
    public let jsName = "NativeLLM"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise)
    ]

    // FoundationModels est-il disponible (iOS 26+, appareil Apple Intelligence activé, modèle prêt) ?
    @objc func available(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                call.resolve(["available": true])
            case .unavailable(let reason):
                call.resolve(["available": false, "reason": String(describing: reason)])
            @unknown default:
                call.resolve(["available": false, "reason": "inconnu"])
            }
            return
        }
        #endif
        call.resolve(["available": false, "reason": "iOS < 26 ou FoundationModels absent"])
    }

    // génère une réponse ancrée sur les instructions (system) + la demande (prompt)
    @objc func generate(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty else {
            call.reject("prompt requis"); return
        }
        let system = call.getString("system") ?? ""
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    let session = system.isEmpty
                        ? LanguageModelSession()
                        : LanguageModelSession(instructions: Instructions(system))
                    let response = try await session.respond(to: Prompt(prompt))
                    call.resolve(["text": response.content])
                } catch {
                    call.reject("Échec de la génération : \(error.localizedDescription)")
                }
            }
            return
        }
        #endif
        call.reject("Assistant natif indisponible (iOS < 26)")
    }
}
