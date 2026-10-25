import AppKit
import ScreenSaver
import WebKit

// Do not assign an explicit @objc class name. The packager supplies a unique Swift
// module per edition, and NSPrincipalClass uses Module.BloxwapScreenSaverView.
// All four bundles can therefore load into the same macOS screen saver process.
@MainActor
public final class BloxwapScreenSaverView: ScreenSaverView, WKNavigationDelegate, WKUIDelegate {
    private var renderer: WKWebView?
    private var schemeHandler: BundleSchemeHandler?
    private var edition: NativeEdition?
    private var running = false
    private var recoveryAttempts = 0
    private var recovery: DispatchWorkItem?
    private var generation = 0
    private var statusLabel: NSTextField?

    public override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        initializeView()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        initializeView()
    }

    private func initializeView() {
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.039, alpha: 1).cgColor
        // WebKit drives its own animation frames; no extra native rendering loop.
        animationTimeInterval = 1
        setAccessibilityElement(true)
        setAccessibilityLabel("Bloxwap screensaver")
    }

    public override var acceptsFirstResponder: Bool { false }

    public override func startAnimation() {
        guard !running else { return }
        super.startAnimation()
        running = true
        recoveryAttempts = 0
        generation += 1
        createRenderer()
    }

    public override func stopAnimation() {
        running = false
        generation += 1
        recovery?.cancel()
        recovery = nil
        destroyRenderer()
        statusLabel?.removeFromSuperview()
        statusLabel = nil
        super.stopAnimation()
    }

    public override func animateOneFrame() {
        // ScreenSaver may invoke this after stopAnimation. There is no work here;
        // the active WKWebView owns frame timing, and stop destroys its document.
    }

    public override func layout() {
        super.layout()
        renderer?.frame = bounds
        if let label = statusLabel {
            let width = max(0, min(bounds.width - 32, 480))
            label.frame = NSRect(x: (bounds.width - width) / 2, y: max(0, (bounds.height - 64) / 2), width: width, height: 64)
        }
    }

    public override func viewWillMove(toWindow newWindow: NSWindow?) {
        if newWindow == nil, running { stopAnimation() }
        super.viewWillMove(toWindow: newWindow)
    }

    private func createRenderer() {
        guard running else { return }
        destroyRenderer()
        do {
            let bundle = Bundle(for: type(of: self))
            let selected = try NativeEdition.load(from: bundle)
            guard let resources = bundle.resourceURL else { throw NativeScreenSaverError.missingRenderer }
            let handler = try BundleSchemeHandler(resourceDirectory: resources.appendingPathComponent("dist", isDirectory: true))
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .nonPersistent()
            configuration.setURLSchemeHandler(handler, forURLScheme: BundleSchemeHandler.scheme)
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
            configuration.preferences.isElementFullscreenEnabled = false
            configuration.allowsAirPlayForMediaPlayback = false
            configuration.mediaTypesRequiringUserActionForPlayback = .all
            configuration.userContentController.addUserScript(WKUserScript(source: try selected.bootstrapScript(isPreview: isPreview), injectionTime: .atDocumentStart, forMainFrameOnly: true))

            let webView = PassiveScreenSaverWebView(frame: bounds, configuration: configuration)
            webView.autoresizingMask = [.width, .height]
            webView.navigationDelegate = self
            webView.uiDelegate = self
            webView.allowsBackForwardNavigationGestures = false
            webView.allowsMagnification = false
            webView.underPageBackgroundColor = NSColor(calibratedWhite: 0.039, alpha: 1)
            edition = selected
            schemeHandler = handler
            renderer = webView
            addSubview(webView)
            setAccessibilityLabel("Bloxwap \(selected.name) screensaver")
            let url = URL(string: "\(BundleSchemeHandler.scheme)://\(BundleSchemeHandler.host)/index.html?asset=\(selected.symbol)")!
            webView.load(URLRequest(url: url))
        } catch {
            showFailure()
        }
    }

    private func destroyRenderer() {
        schemeHandler?.invalidate()
        schemeHandler = nil
        guard let webView = renderer else { return }
        renderer = nil
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.stopLoading()
        webView.configuration.userContentController.removeAllUserScripts()
        // Navigating away terminates the page's WebSockets/timers even if WebKit
        // retains its process briefly after the native view is released.
        webView.loadHTMLString("<!doctype html><html><body></body></html>", baseURL: nil)
        webView.removeFromSuperview()
    }

    private func showFailure() {
        guard running else { return }
        statusLabel?.removeFromSuperview()
        let label = NSTextField(wrappingLabelWithString: "Bloxwap Screensaver could not load.\nChoose another screen saver, then try again.")
        label.alignment = .center
        label.textColor = .secondaryLabelColor
        label.font = NSFont.systemFont(ofSize: isPreview ? 12 : 17)
        label.isSelectable = false
        statusLabel = label
        addSubview(label)
        needsLayout = true
    }

    private func recoverRenderer(_ webView: WKWebView) {
        guard running, renderer === webView else { return }
        destroyRenderer()
        showFailure()
        guard recoveryAttempts < 3 else { return }
        recoveryAttempts += 1
        let currentGeneration = generation
        let task = DispatchWorkItem { [weak self] in
            guard let self, self.running, self.generation == currentGeneration else { return }
            self.recovery = nil
            self.createRenderer()
        }
        recovery?.cancel()
        recovery = task
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(1 << (recoveryAttempts - 1)), execute: task)
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard running, renderer === webView else { return }
        statusLabel?.removeFromSuperview()
        statusLabel = nil
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { recoverRenderer(webView) }
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { recoverRenderer(webView) }
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        recoverRenderer(webView)
    }

    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard running, renderer === webView, navigationAction.targetFrame?.isMainFrame == true,
              let url = navigationAction.request.url,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == BundleSchemeHandler.scheme, components.host == BundleSchemeHandler.host,
              components.user == nil, components.password == nil, components.port == nil,
              components.path == "/index.html",
              components.queryItems?.count == 1,
              components.queryItems?.first?.name == "asset",
              components.queryItems?.first?.value == edition?.symbol else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    public func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }

    public func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { completionHandler(false) }

    public func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) { completionHandler(nil) }
}

/// System Settings and ScreenSaverEngine keep responsibility for keyboard/mouse
/// input and dismissal; the embedded page never becomes an interactive app.
@MainActor
private final class PassiveScreenSaverWebView: WKWebView {
    override var acceptsFirstResponder: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
