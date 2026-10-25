import AppKit
import Foundation
import ScreenSaver
import WebKit

// A bounded standalone test host that restores the prior frontmost application.
// It does not install a screen saver,
// change defaults, invoke ScreenSaverEngine, or alter the user's lock/sleep state.
struct SmokeEdition: Decodable {
    let path: String
    let symbol: String
    let name: String
}

struct SmokePlan: Decodable {
    let editions: [SmokeEdition]
    let requireLive: Bool
    let sustainSeconds: Double
    let timeoutSeconds: Double
    let outputDirectory: String
}

struct SmokeFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class SmokeInstance {
    let edition: SmokeEdition
    let preview: Bool
    let window: NSWindow
    let view: ScreenSaverView
    var webView: WKWebView?

    init(edition: SmokeEdition, preview: Bool, window: NSWindow, view: ScreenSaverView) {
        self.edition = edition
        self.preview = preview
        self.window = window
        self.view = view
    }

    var label: String { "\(edition.symbol)-\(preview ? "preview" : "full")" }
}

@MainActor
final class NativeSmoke {
    let plan: SmokePlan
    var instances: [SmokeInstance] = []
    var bundles: [Bundle] = []
    var results: [[String: Any]] = []
    let started = Date()
    let previousApplication = NSWorkspace.shared.frontmostApplication

    init(plan: SmokePlan) { self.plan = plan }

    func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw SmokeFailure(message: message) }
    }

    func wait(_ label: String, seconds: Double = 30, condition: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(seconds)
        var lastError: Error?
        while Date() < deadline {
            do { if try await condition() { return } } catch { lastError = error }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw SmokeFailure(message: "Timed out: \(label)\(lastError.map { ": \($0.localizedDescription)" } ?? "")")
    }

    func webViews(in view: NSView) -> [WKWebView] {
        view.subviews.flatMap { child in
            if let webView = child as? WKWebView { return [webView] }
            return webViews(in: child)
        }
    }

    func evaluate(_ source: String, in webView: WKWebView) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(source) { value, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value) }
            }
        }
    }

    // Observation-only instrumentation is installed in the test WKWebView before
    // reloading its real bundled document. It forwards actual sockets and WASM;
    // no prices, feeds, or production resources are replaced with fixtures.
    let observationScript = #"""
    (() => {
      const state = { socketsCreated: 0, socketCloseCalls: 0, socketsActive: 0,
        socketMessages: 0, socketEvents: [], http: [], wasmCompiled: 0,
        wasmInstantiated: 0, frames: 0, errors: [] };
      Object.defineProperty(window, '__bloxwapNativeSmoke', { value: state });
      addEventListener('error', event => state.errors.push(String(event.message)));
      addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)));
      const OriginalSocket = window.WebSocket;
      const close = OriginalSocket.prototype.close;
      OriginalSocket.prototype.close = function (...args) {
        state.socketCloseCalls++;
        return Reflect.apply(close, this, args);
      };
      window.WebSocket = new Proxy(OriginalSocket, { construct(target, args) {
        state.socketsCreated++;
        state.socketsActive++;
        const socket = Reflect.construct(target, args);
        const record = event => { state.socketEvents.push(event); if (state.socketEvents.length > 20) state.socketEvents.shift(); };
        socket.addEventListener('open', () => record({type:'open',url:String(args[0])}));
        socket.addEventListener('message', () => { state.socketMessages++; });
        socket.addEventListener('error', () => record({type:'error',url:String(args[0])}));
        socket.addEventListener('close', event => {
          state.socketsActive--;
          record({type:'close',code:event.code,reason:event.reason,clean:event.wasClean});
        });
        return socket;
      } });
      const originalFetch = window.fetch;
      window.fetch = (...args) => Reflect.apply(originalFetch, window, args).then(response => {
        state.http.push({url:response.url,status:response.status});
        if (state.http.length > 20) state.http.shift();
        return response;
      }, error => {
        state.http.push({url:String(args[0]?.url || args[0]),error:String(error)});
        if (state.http.length > 20) state.http.shift();
        throw error;
      });
      for (const [method, field] of [['compile', 'wasmCompiled'], ['instantiate', 'wasmInstantiated']]) {
        const original = WebAssembly[method];
        WebAssembly[method] = (...args) => Reflect.apply(original, WebAssembly, args).then(result => {
          state[field]++;
          return result;
        });
      }
      const frame = () => { state.frames++; requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    })();
    """#

    let snapshotScript = #"""
    (() => {
      const screen = document.querySelector('.screensaver');
      const canvas = document.querySelector('.chart-plot canvas');
      const icon = document.querySelector('.asset-pill img');
      const bridge = window.nativeScreensaver;
      const descriptor = Object.getOwnPropertyDescriptor(window, 'nativeScreensaver');
      const probe = window.__bloxwapNativeSmoke;
      return JSON.stringify({
        ready: !!(screen && canvas && icon?.complete && icon.naturalWidth && probe),
        asset: screen?.dataset.asset, host: screen?.dataset.host,
        bridgeAsset: bridge?.asset, isPreview: bridge?.isPreview,
        immutable: !!(bridge && Object.isFrozen(bridge) && descriptor && !descriptor.configurable && !descriptor.writable),
        canvasWidth: canvas?.width || 0, canvasHeight: canvas?.height || 0,
        icon: icon?.getAttribute('src'), title: document.title,
        controls: !!document.querySelector('.display-controls'),
        downloads: !!document.querySelector('.preview-return'),
        manifest: !!document.querySelector('link[rel="manifest"]'),
        price: Number(document.querySelector('[data-testid="header-price"]')?.getAttribute('data-price') || 0),
        status: document.querySelector('.connection-status')?.textContent || '',
        fontsLoaded: document.fonts.status === 'loaded',
        visible: !document.hidden, url: location.href,
        probe: probe || null
      });
    })();
    """#

    func snapshot(_ instance: SmokeInstance) async throws -> [String: Any] {
        guard let webView = instance.webView,
              let text = try await evaluate(snapshotScript, in: webView) as? String,
              let data = text.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw SmokeFailure(message: "\(instance.label): missing renderer snapshot")
        }
        return object
    }

    func assertSnapshot(_ object: [String: Any], _ instance: SmokeInstance) throws {
        try require(object["ready"] as? Bool == true, "\(instance.label): renderer/asset image not ready")
        try require(object["asset"] as? String == instance.edition.symbol, "\(instance.label): wrong rendered asset")
        try require(object["bridgeAsset"] as? String == instance.edition.symbol, "\(instance.label): wrong immutable edition")
        try require(object["isPreview"] as? Bool == instance.preview, "\(instance.label): wrong preview mode")
        try require(object["immutable"] as? Bool == true, "\(instance.label): mutable native bridge")
        try require(object["host"] as? String == "native", "\(instance.label): browser/desktop app mode leaked into native host")
        try require(object["controls"] as? Bool == false && object["downloads"] as? Bool == false, "\(instance.label): interactive browser controls visible")
        try require(object["manifest"] as? Bool == false, "\(instance.label): native host exposed a PWA manifest")
        try require((object["canvasWidth"] as? Int ?? 0) > 0 && (object["canvasHeight"] as? Int ?? 0) > 0, "\(instance.label): empty chart canvas")
        try require(object["fontsLoaded"] as? Bool == true, "\(instance.label): bundled fonts not loaded")
        let probe = object["probe"] as? [String: Any] ?? [:]
        try require((probe["wasmCompiled"] as? Int ?? 0) > 0 && (probe["wasmInstantiated"] as? Int ?? 0) > 0, "\(instance.label): chart WASM did not compile and instantiate")
        try require((probe["errors"] as? [String] ?? []).isEmpty, "\(instance.label): JavaScript errors \(probe["errors"] ?? "unknown")")
    }

    func loadDocument(_ instance: SmokeInstance) async throws {
        try await wait("\(instance.label) WKWebView") { self.webViews(in: instance.view).count == 1 }
        instance.webView = webViews(in: instance.view).first
        guard let webView = instance.webView else { throw SmokeFailure(message: "Missing web view") }
        try await wait("\(instance.label) initial navigation") { webView.url?.scheme == "bloxwap-screensaver" && !webView.isLoading }
        let originalVisibility = try await evaluate("JSON.stringify({hidden:document.hidden,state:document.visibilityState,ready:!!document.querySelector('.screensaver')})", in: webView)
        print("Initial \(instance.label): \(originalVisibility ?? "unknown"), WKframe=\(webView.frame), visibleRect=\(webView.visibleRect), hidden=\(webView.isHiddenOrHasHiddenAncestor), windowAttached=\(webView.window === instance.window)")
        webView.configuration.userContentController.addUserScript(WKUserScript(source: observationScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.reload()
        try await wait("\(instance.label) bundled renderer and WASM") {
            let object = try await self.snapshot(instance)
            try self.assertSnapshot(object, instance)
            return true
        }
        let ready = try await snapshot(instance)
        print("Loaded \(instance.label): native renderer, chart WASM, fonts; visible=\(ready["visible"] ?? "unknown"), status=\(ready["status"] ?? "unknown"), price=\(ready["price"] ?? "unknown")")
        print("AppKit \(instance.label): visible=\(instance.window.isVisible), occlusion=\(instance.window.occlusionState.rawValue), activeSpace=\(instance.window.isOnActiveSpace), hiddenAncestor=\(instance.view.isHiddenOrHasHiddenAncestor), frame=\(instance.window.frame), policy=\(NSApplication.shared.activationPolicy().rawValue), active=\(NSApplication.shared.isActive)")
        if plan.requireLive {
            try await wait("\(instance.label) fresh live quote", seconds: 45) {
                let object = try await self.snapshot(instance)
                try self.require(object["status"] as? String == "Live" && (object["price"] as? Double ?? 0) > 0,
                    "visible=\(object["visible"] ?? "unknown"), status=\(object["status"] ?? "unknown"), price=\(object["price"] ?? "unknown"), probe=\(object["probe"] ?? "unknown")")
                return true
            }
        }
    }

    func imageEvidence(_ instance: SmokeInstance) async throws -> String {
        guard let webView = instance.webView else { throw SmokeFailure(message: "Missing web view for snapshot") }
        let configuration = WKSnapshotConfiguration()
        configuration.afterScreenUpdates = true
        let image: NSImage = try await withCheckedThrowingContinuation { continuation in
            webView.takeSnapshot(with: configuration) { image, error in
                if let error { continuation.resume(throwing: error) }
                else if let image { continuation.resume(returning: image) }
                else { continuation.resume(throwing: SmokeFailure(message: "\(instance.label): empty WK snapshot")) }
            }
        }
        guard let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            throw SmokeFailure(message: "\(instance.label): cannot encode WK snapshot")
        }
        try require(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0, "\(instance.label): zero-size snapshot")
        var colors = Set<String>()
        for y in stride(from: 0, to: bitmap.pixelsHigh, by: max(1, bitmap.pixelsHigh / 60)) {
            for x in stride(from: 0, to: bitmap.pixelsWide, by: max(1, bitmap.pixelsWide / 80)) {
                if let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) {
                    colors.insert("\(Int(color.redComponent * 255)),\(Int(color.greenComponent * 255)),\(Int(color.blueComponent * 255))")
                }
            }
        }
        try require(colors.count > 8, "\(instance.label): blank or monochrome WK snapshot (\(colors.count) colors)")
        let path = URL(fileURLWithPath: plan.outputDirectory).appendingPathComponent("\(instance.label).png")
        try png.write(to: path)
        return path.path
    }

    func verifyMarketLifecycle(_ instance: SmokeInstance) async throws {
        guard let webView = instance.webView else { throw SmokeFailure(message: "Missing renderer") }
        let before = try await snapshot(instance)["probe"] as? [String: Any] ?? [:]
        let created = before["socketsCreated"] as? Int ?? 0
        try require(created > 0, "\(instance.label): no market subscription attempted")
        _ = try await evaluate("dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true})); true", in: webView)
        try await wait("\(instance.label) market teardown", seconds: 5) {
            let probe = try await self.snapshot(instance)["probe"] as? [String: Any] ?? [:]
            return (probe["socketCloseCalls"] as? Int ?? 0) >= created
        }
        _ = try await evaluate("dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true})); true", in: webView)
        try await wait("\(instance.label) market resume", seconds: 5) {
            let probe = try await self.snapshot(instance)["probe"] as? [String: Any] ?? [:]
            return (probe["socketsCreated"] as? Int ?? 0) > created
        }
    }

    func restart(_ instance: SmokeInstance) async throws {
        weak var retired = instance.webView
        instance.view.stopAnimation()
        try require(!instance.view.isAnimating, "\(instance.label): stopAnimation left native timer running")
        try require(webViews(in: instance.view).isEmpty, "\(instance.label): stopped renderer remains attached")
        instance.webView = nil
        try await wait("\(instance.label) previous WKWebView released", seconds: 10) { retired == nil }
        retired = nil
        instance.view.startAnimation()
        try require(instance.view.isAnimating, "\(instance.label): restart did not activate animation")
        try await loadDocument(instance)
        try require(webViews(in: instance.view).count == 1, "\(instance.label): restart created duplicate renderers")
    }

    func cleanUp() {
        for instance in instances {
            instance.view.stopAnimation()
            instance.webView = nil
            instance.view.removeFromSuperview()
            instance.window.orderOut(nil)
            instance.window.close()
        }
        if let previousApplication, previousApplication.processIdentifier != ProcessInfo.processInfo.processIdentifier {
            previousApplication.activate(options: [])
        }
    }

    func run() async throws {
        try FileManager.default.createDirectory(atPath: plan.outputDirectory, withIntermediateDirectories: true)
        try require(!NSScreen.screens.isEmpty, "Native runtime smoke requires a graphical macOS session.")
        if previousApplication?.bundleIdentifier == "com.apple.loginwindow" || previousApplication?.executableURL?.lastPathComponent == "loginwindow" {
            print("Session diagnostic: loginwindow is frontmost. If WebKit remains hidden, rerun on an unlocked desktop; visibility and animation checks remain required.")
        }
        var principalNames = Set<String>()
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 40, y: 40, width: 1280, height: 800)
        let columnCount = plan.editions.count > 2 ? 4 : 2
        let rowCount = Int(ceil(Double(plan.editions.count * 2) / Double(columnCount)))
        let tileWidth = min(640, (screen.width - 40) / CGFloat(columnCount) - 12)
        let tileHeight = min(360, (screen.height - 80) / CGFloat(rowCount) - 12)
        for edition in plan.editions {
            guard let bundle = Bundle(path: edition.path), bundle.load(),
                  let principal = bundle.principalClass as? ScreenSaverView.Type,
                  let principalName = bundle.object(forInfoDictionaryKey: "NSPrincipalClass") as? String else {
                throw SmokeFailure(message: "Cannot load ScreenSaverView principal class from \(edition.path)")
            }
            try require(principalNames.insert(principalName).inserted, "Edition principal-class collision: \(principalName)")
            bundles.append(bundle)
            for preview in [false, true] {
                let size = preview ? NSSize(width: min(320, tileWidth), height: min(180, tileHeight)) : NSSize(width: tileWidth, height: tileHeight)
                guard let view = principal.init(frame: NSRect(origin: .zero, size: size), isPreview: preview) else {
                    throw SmokeFailure(message: "\(edition.symbol): designated ScreenSaverView initializer failed")
                }
                let index = instances.count
                let x = screen.minX + 20 + CGFloat(index % columnCount) * (tileWidth + 12)
                let y = screen.maxY - 40 - CGFloat(index / columnCount + 1) * (tileHeight + 12)
                let window = NSWindow(contentRect: NSRect(x: x, y: y, width: size.width, height: size.height), styleMask: [.titled], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.ignoresMouseEvents = true
                window.animationBehavior = .none
                window.title = "Bloxwap native smoke"
                window.level = .floating
                window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
                window.contentView = NSView(frame: NSRect(origin: .zero, size: size))
                window.contentView?.addSubview(view)
                view.autoresizingMask = [.width, .height]
                window.orderFrontRegardless()
                window.displayIfNeeded()
                let instance = SmokeInstance(edition: edition, preview: preview, window: window, view: view)
                instances.append(instance)
                try require(view.isPreview == preview, "\(instance.label): ScreenSaverView preview flag changed")
                view.startAnimation()
                window.contentView?.layoutSubtreeIfNeeded()
                window.displayIfNeeded()
            }
        }
        // WebKit visibility in a command-line AppKit harness may remain hidden
        // until its host is active. Restore the prior application during cleanup.
        NSApplication.shared.activate(ignoringOtherApps: true)
        instances.first?.window.makeKeyAndOrderFront(nil)
        // All edition classes and both instance modes coexist during verification.
        for instance in instances { try await loadDocument(instance) }
        let initial = try await instances.asyncMap { try await self.snapshot($0) }
        try await Task.sleep(nanoseconds: UInt64(plan.sustainSeconds * 1_000_000_000))
        for (index, instance) in instances.enumerated() {
            let sustained = try await snapshot(instance)
            try assertSnapshot(sustained, instance)
            let beforeProbe = initial[index]["probe"] as? [String: Any] ?? [:]
            let afterProbe = sustained["probe"] as? [String: Any] ?? [:]
            try require(sustained["visible"] as? Bool == true,
                "\(instance.label): WebKit remains hidden despite a visible test window. Frontmost app before launch: \(previousApplication?.bundleIdentifier ?? previousApplication?.localizedName ?? "unknown"). Use an unlocked graphical desktop; this run cannot verify visible animation.")
            try require((afterProbe["frames"] as? Int ?? 0) > (beforeProbe["frames"] as? Int ?? 0) + 5, "\(instance.label): animation frames stopped during sustained rendering")
            let screenshot = try await imageEvidence(instance)
            try await verifyMarketLifecycle(instance)
            instance.window.setContentSize(NSSize(width: instance.view.bounds.width - 12, height: instance.view.bounds.height - 12))
            instance.view.layoutSubtreeIfNeeded()
            try await wait("\(instance.label) resize") {
                guard let webView = instance.webView else { return false }
                return abs(webView.frame.width - instance.view.bounds.width) < 1 && abs(webView.frame.height - instance.view.bounds.height) < 1
            }
            try await restart(instance)
            let restarted = try await snapshot(instance)
            try assertSnapshot(restarted, instance)
            results.append(["asset": instance.edition.symbol, "isPreview": instance.preview,
                "initial": initial[index], "sustained": sustained, "restarted": restarted,
                "screenshot": screenshot, "previousWebViewReleased": true, "marketLifecycleVerified": true])
            print("Verified \(instance.label): bundled renderer, chart WASM, resize, disposal, restart")
        }
        cleanUp()
        let report: [String: Any] = ["ok": true, "mode": "standalone-screen-saver-view", "requireLive": plan.requireLive,
            "sustainSeconds": plan.sustainSeconds, "elapsedSeconds": Date().timeIntervalSince(started),
            "os": ProcessInfo.processInfo.operatingSystemVersionString, "instances": results,
            "limitations": ["Standalone host evidence does not certify System Settings or ScreenSaverEngine behavior.",
                "The standalone host is activated temporarily; cleanup restores the prior frontmost app. Test panels ignore mouse events, and PNGs use WKWebView.takeSnapshot."]]
        let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: plan.outputDirectory).appendingPathComponent("report.json"))
        print("Native smoke passed: \(instances.count) view instances, \(plan.editions.count) editions")
    }
}

extension Array {
    @MainActor
    func asyncMap<T>(_ transform: (Element) async throws -> T) async rethrows -> [T] {
        var output: [T] = []
        for element in self { output.append(try await transform(element)) }
        return output
    }
}

setbuf(stdout, nil)
guard CommandLine.arguments.count == 2 else {
    fputs("Usage: MacScreenSaverSmoke <plan.json>\n", stderr)
    exit(2)
}

do {
    let plan = try JSONDecoder().decode(SmokePlan.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
    let application = NSApplication.shared
    // A normal AppKit host can exercise actual visible WebKit rendering. The
    // test restores the previously active app without changing any preferences.
    application.setActivationPolicy(.regular)
    DispatchQueue.global().asyncAfter(deadline: .now() + plan.timeoutSeconds) {
        fputs("Native smoke exceeded its bounded timeout.\n", stderr)
        exit(124)
    }
    Task { @MainActor in
        let smoke = NativeSmoke(plan: plan)
        do {
            try await smoke.run()
            exit(0)
        } catch {
            smoke.cleanUp()
            if let data = try? JSONSerialization.data(withJSONObject: ["ok": false, "error": error.localizedDescription], options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: URL(fileURLWithPath: plan.outputDirectory).appendingPathComponent("report.json"))
            }
            fputs("Native smoke failed: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
    application.run()
} catch {
    fputs("Native smoke configuration failed: \(error.localizedDescription)\n", stderr)
    exit(2)
}
