import Foundation

struct NativeEdition: Decodable {
    let symbol: String
    let name: String
    let slug: String

    static func load(from bundle: Bundle) throws -> NativeEdition {
        guard let metadataURL = bundle.url(forResource: "edition", withExtension: "json"),
              let plistSymbol = bundle.object(forInfoDictionaryKey: "BloxwapAssetSymbol") as? String else {
            throw NativeScreenSaverError.invalidEdition
        }
        let edition = try JSONDecoder().decode(NativeEdition.self, from: Data(contentsOf: metadataURL))
        let expected = ["BTC": "bitcoin", "SOL": "solana", "ETH": "ethereum", "HYPE": "hyperliquid"]
        guard expected[edition.symbol] == edition.slug, plistSymbol == edition.symbol,
              !edition.name.isEmpty, edition.name.count <= 40 else {
            throw NativeScreenSaverError.invalidEdition
        }
        return edition
    }

    func bootstrapScript(isPreview: Bool) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: ["asset": symbol, "isPreview": isPreview])
        guard let json = String(data: data, encoding: .utf8) else {
            throw NativeScreenSaverError.invalidEdition
        }
        return "Object.defineProperty(window, 'nativeScreensaver', { value: Object.freeze(\(json)), writable: false, configurable: false, enumerable: true });"
    }
}

enum NativeScreenSaverError: LocalizedError {
    case invalidEdition
    case missingRenderer
    case invalidResource
    case unsupportedResource
    case resourceTooLarge

    var errorDescription: String? {
        switch self {
        case .invalidEdition: return "This screensaver's asset metadata is missing or invalid."
        case .missingRenderer: return "The bundled screensaver display is missing."
        case .invalidResource: return "The requested resource is outside the screensaver bundle."
        case .unsupportedResource: return "The requested resource type is unsupported."
        case .resourceTooLarge: return "The requested resource exceeds the bundled display limit."
        }
    }
}
