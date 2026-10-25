import Foundation
import WebKit

/// Serves the installed renderer without a localhost server, file-access overrides,
/// or a remotely hosted page. Every handler belongs to exactly one view instance.
@MainActor
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "bloxwap-screensaver"
    static let host = "bundle"

    private let root: URL
    private var activeTasks = Set<ObjectIdentifier>()
    private var invalidated = false

    init(resourceDirectory: URL) throws {
        let resolved = resourceDirectory.standardizedFileURL.resolvingSymlinksInPath()
        var directory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &directory), directory.boolValue,
              FileManager.default.fileExists(atPath: resolved.appendingPathComponent("index.html").path) else {
            throw NativeScreenSaverError.missingRenderer
        }
        root = resolved
        super.init()
    }

    func invalidate() {
        invalidated = true
        activeTasks.removeAll()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard !invalidated else { return }
        let identifier = ObjectIdentifier(urlSchemeTask)
        activeTasks.insert(identifier)
        defer { activeTasks.remove(identifier) }

        // Small, immutable bundled assets are read synchronously on the main actor.
        // Delivery and cancellation consequently cannot race on another queue.
        do {
            let request = urlSchemeTask.request
            guard let url = request.url, request.httpMethod == nil || request.httpMethod == "GET" || request.httpMethod == "HEAD" else {
                throw NativeScreenSaverError.invalidResource
            }
            let file = try resourceURL(for: url)
            let attributes = try file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard attributes.isRegularFile == true else { throw NativeScreenSaverError.invalidResource }
            guard let size = attributes.fileSize, size <= 32 * 1_024 * 1_024 else { throw NativeScreenSaverError.resourceTooLarge }
            let mime = try Self.mimeType(for: file.pathExtension)
            let data = try Data(contentsOf: file, options: .mappedIfSafe)
            guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                "Content-Type": mime,
                "Content-Length": String(data.count),
                "Cache-Control": "no-store",
                // WebKit gives custom schemes an opaque origin. Local ES modules,
                // font requests, and fetch/instantiateStreaming need CORS headers.
                "Access-Control-Allow-Origin": "*",
                "Cross-Origin-Resource-Policy": "cross-origin",
                "X-Content-Type-Options": "nosniff",
            ]) else { throw NativeScreenSaverError.invalidResource }
            guard activeTasks.contains(identifier), !invalidated else { return }
            urlSchemeTask.didReceive(response)
            guard activeTasks.contains(identifier), !invalidated else { return }
            if request.httpMethod != "HEAD" { urlSchemeTask.didReceive(data) }
            guard activeTasks.contains(identifier), !invalidated else { return }
            urlSchemeTask.didFinish()
        } catch {
            guard activeTasks.contains(identifier), !invalidated else { return }
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        activeTasks.remove(ObjectIdentifier(urlSchemeTask))
    }

    func resourceURL(for url: URL) throws -> URL {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == Self.scheme, components.host == Self.host,
              components.user == nil, components.password == nil, components.port == nil,
              let decodedPath = components.percentEncodedPath.removingPercentEncoding,
              decodedPath.hasPrefix("/"), !decodedPath.contains("\\"), !decodedPath.contains("\0") else {
            throw NativeScreenSaverError.invalidResource
        }
        let parts = decodedPath.split(separator: "/", omittingEmptySubsequences: false)
        guard !parts.contains(".."), !parts.contains(".") else { throw NativeScreenSaverError.invalidResource }
        let relative = decodedPath == "/" ? "index.html" : String(decodedPath.dropFirst())
        guard !relative.isEmpty else { throw NativeScreenSaverError.invalidResource }
        let candidate = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard candidate.path.hasPrefix(root.path + "/") else { throw NativeScreenSaverError.invalidResource }
        return candidate
    }

    static func mimeType(for fileExtension: String) throws -> String {
        let types = [
            "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
            "css": "text/css; charset=utf-8", "json": "application/json", "webmanifest": "application/manifest+json",
            "wasm": "application/wasm", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "webp": "image/webp", "gif": "image/gif", "ico": "image/x-icon", "woff": "font/woff", "woff2": "font/woff2",
            "ttf": "font/ttf", "otf": "font/otf", "txt": "text/plain; charset=utf-8", "map": "application/json",
        ]
        guard let value = types[fileExtension.lowercased()] else { throw NativeScreenSaverError.unsupportedResource }
        return value
    }
}
