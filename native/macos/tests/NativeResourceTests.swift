import Foundation

private enum TestFailure: Error { case failed(String) }

@main
struct NativeResourceTests {
    @MainActor
    static func main() throws {
        let files = FileManager.default
        let temporary = files.temporaryDirectory.appendingPathComponent("bloxwap-native-resources-\(UUID().uuidString)", isDirectory: true)
        try files.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: temporary) }
        let root = temporary.appendingPathComponent("dist", isDirectory: true)
        try files.createDirectory(at: root.appendingPathComponent("assets"), withIntermediateDirectories: true)
        try Data("<!doctype html>".utf8).write(to: root.appendingPathComponent("index.html"))
        try Data("export const value = 1;".utf8).write(to: root.appendingPathComponent("assets/chart.js"))
        try Data("outside".utf8).write(to: temporary.appendingPathComponent("secret.txt"))
        try files.createSymbolicLink(at: root.appendingPathComponent("escape.txt"), withDestinationURL: temporary.appendingPathComponent("secret.txt"))

        let handler = try BundleSchemeHandler(resourceDirectory: root)
        func check(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
            if try !value() { throw TestFailure.failed(message) }
        }
        func reject(_ url: String) throws {
            do {
                _ = try handler.resourceURL(for: URL(string: url)!)
                throw TestFailure.failed("Accepted forbidden path: \(url)")
            } catch is NativeScreenSaverError { }
        }
        try check(try handler.resourceURL(for: URL(string: "bloxwap-screensaver://bundle/")!).path == root.appendingPathComponent("index.html").path, "Root resolves to bundled index")
        try check(try handler.resourceURL(for: URL(string: "bloxwap-screensaver://bundle/assets/chart.js?version=1")!).path == root.appendingPathComponent("assets/chart.js").path, "Dynamic module path")
        for url in [
            "bloxwap-screensaver://bundle/../secret.txt",
            "bloxwap-screensaver://bundle/%2e%2e/secret.txt",
            "bloxwap-screensaver://bundle/assets/%2e%2e/index.html",
            "bloxwap-screensaver://bundle/escape.txt",
            "bloxwap-screensaver://bundle/%5c..%5csecret.txt",
            "bloxwap-screensaver://bundle/%00index.html",
            "bloxwap-screensaver://other/index.html",
            "bloxwap-screensaver://user@bundle/index.html",
            "bloxwap-screensaver://bundle:80/index.html",
            "https://bundle/index.html",
            "file:///index.html",
        ] { try reject(url) }
        try check(try BundleSchemeHandler.mimeType(for: "wasm") == "application/wasm", "Streaming WebAssembly MIME")
        try check(try BundleSchemeHandler.mimeType(for: "js").hasPrefix("text/javascript"), "ES module MIME")
        try check(try BundleSchemeHandler.mimeType(for: "woff2") == "font/woff2", "Bundled font MIME")
        do {
            _ = try BundleSchemeHandler.mimeType(for: "dylib")
            throw TestFailure.failed("Accepted native binary resource")
        } catch is NativeScreenSaverError { }

        for (symbol, name, slug) in [("BTC", "Bitcoin", "bitcoin"), ("SOL", "Solana", "solana"), ("ETH", "Ethereum", "ethereum"), ("HYPE", "Hyperliquid", "hyperliquid")] {
            let bundleURL = temporary.appendingPathComponent("\(symbol).bundle", isDirectory: true)
            let contents = bundleURL.appendingPathComponent("Contents", isDirectory: true)
            let resources = contents.appendingPathComponent("Resources", isDirectory: true)
            try files.createDirectory(at: resources, withIntermediateDirectories: true)
            let info: [String: Any] = ["CFBundleIdentifier": "com.bloxwap.native-test.\(slug)", "CFBundlePackageType": "BNDL", "BloxwapAssetSymbol": symbol]
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: contents.appendingPathComponent("Info.plist"))
            try JSONSerialization.data(withJSONObject: ["symbol": symbol, "name": name, "slug": slug]).write(to: resources.appendingPathComponent("edition.json"))
            guard let bundle = Bundle(url: bundleURL) else { throw TestFailure.failed("Could not inspect fixture bundle") }
            let edition = try NativeEdition.load(from: bundle)
            try check(edition.symbol == symbol && edition.slug == slug, "Immutable edition identity")
            let bootstrap = try edition.bootstrapScript(isPreview: true)
            try check(bootstrap.contains("Object.freeze") && bootstrap.contains("configurable: false") && bootstrap.contains("writable: false"), "Read-only bootstrap")
        }
        print("Native resource tests passed: safe bundle resolution, traversal/symlink rejection, MIME types, and all four edition bundles.")
    }
}
