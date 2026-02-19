//
//  ViewController.swift
//  furikana
//
//  Created by 林向達 on 2026/02/15.
//

import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    private let appGroupId = "group.con3.furikana"
    private let settingsKey = "furikanaSettings"

    private var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self
        self.webView.scrollView.isScrollEnabled = false

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        NSLog("[FuriFuri] Message received: %@", String(describing: message.body))

        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            NSLog("[FuriFuri] Failed to parse message body")
            return
        }

        NSLog("[FuriFuri] Action: %@", action)

        switch action {
        case "openOptions":
            loadOptionsPage()
        case "openLicenses":
            loadLicensesPage()
        case "storageGet":
            handleStorageGet(body)
        case "storageSet":
            handleStorageSet(body)
        case "goBack":
            loadMainPage()
        default:
            break
        }
    }

    // MARK: - Options ページ読み込み

    private func loadOptionsPage() {
        guard let plugInsURL = Bundle.main.builtInPlugInsURL else {
            NSLog("[FuriFuri] builtInPlugInsURL not found")
            return
        }

        let appexURL = plugInsURL.appendingPathComponent("FuriFuri Extension.appex")
        guard let extensionBundle = Bundle(url: appexURL) else {
            NSLog("[FuriFuri] Extension bundle not found at: %@", appexURL.path)
            return
        }

        // PBXFileSystemSynchronizedRootGroup はリソースをフラット化する場合がある
        // Resources/ サブディレクトリとバンドルルートの両方を探索
        let optionsURL: URL
        let resourceURL: URL
        if let url = extensionBundle.url(forResource: "options", withExtension: "html", subdirectory: "Resources") {
            optionsURL = url
            resourceURL = extensionBundle.url(forResource: "Resources", withExtension: nil)!
        } else if let url = extensionBundle.url(forResource: "options", withExtension: "html") {
            optionsURL = url
            resourceURL = extensionBundle.bundleURL
        } else {
            NSLog("[FuriFuri] options.html not found in extension bundle. Bundle path: %@", extensionBundle.bundlePath)
            return
        }
        NSLog("[FuriFuri] Loading options from: %@", optionsURL.path)

        // UserScript を注入するため、新しい WKWebViewConfiguration で userScripts をリセット
        let ucc = self.webView.configuration.userContentController
        ucc.removeAllUserScripts()

        // browser.storage.local ポリフィル（atDocumentStart で注入）
        let polyfillScript = WKUserScript(
            source: Self.storageBridgeJS,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        ucc.addUserScript(polyfillScript)

        // 戻るボタン注入（atDocumentEnd で注入）
        let backButtonScript = WKUserScript(
            source: Self.backButtonJS,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        ucc.addUserScript(backButtonScript)

        self.webView.scrollView.isScrollEnabled = true
        self.webView.loadFileURL(optionsURL, allowingReadAccessTo: resourceURL)
    }

    private func loadLicensesPage() {
        let ucc = self.webView.configuration.userContentController
        ucc.removeAllUserScripts()

        guard let licensesURL = Bundle.main.url(forResource: "licenses", withExtension: "html") else {
            NSLog("[FuriFuri] licenses.html not found")
            return
        }

        self.webView.scrollView.isScrollEnabled = true
        self.webView.loadFileURL(licensesURL, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    private func loadMainPage() {
        // UserScript をクリア
        let ucc = self.webView.configuration.userContentController
        ucc.removeAllUserScripts()

        self.webView.scrollView.isScrollEnabled = false
        self.webView.loadFileURL(
            Bundle.main.url(forResource: "Main", withExtension: "html")!,
            allowingReadAccessTo: Bundle.main.resourceURL!
        )
    }

    // MARK: - Storage ブリッジ

    private func handleStorageGet(_ body: [String: Any]) {
        guard let callbackId = body["callbackId"] as? String else {
            NSLog("[FuriFuri] storageGet: missing callbackId")
            return
        }

        let defaults = body["defaults"] as? [String: Any] ?? [:]
        let sd = sharedDefaults
        NSLog("[FuriFuri] storageGet: sharedDefaults is %@", sd != nil ? "valid" : "NIL")
        let stored = sd?.dictionary(forKey: settingsKey) ?? [:]
        NSLog("[FuriFuri] storageGet: stored keys = %@, defaults keys = %@",
              stored.keys.sorted().description, defaults.keys.sorted().description)

        // defaults に stored をマージ（stored が優先）
        var merged = defaults
        for (key, value) in stored {
            merged[key] = value
        }

        NSLog("[FuriFuri] storageGet: returning %d keys", merged.count)
        sendCallback(callbackId: callbackId, data: merged)
    }

    private func handleStorageSet(_ body: [String: Any]) {
        guard let callbackId = body["callbackId"] as? String,
              let data = body["data"] as? [String: Any] else {
            NSLog("[FuriFuri] storageSet: missing callbackId or data")
            return
        }

        let sd = sharedDefaults
        NSLog("[FuriFuri] storageSet: sharedDefaults is %@", sd != nil ? "valid" : "NIL")
        NSLog("[FuriFuri] storageSet: saving keys = %@", data.keys.sorted().description)

        // 既存の設定にマージ
        var stored = sd?.dictionary(forKey: settingsKey) ?? [:]
        for (key, value) in data {
            stored[key] = value
        }
        sd?.set(stored, forKey: settingsKey)

        NSLog("[FuriFuri] storageSet: total stored keys = %d", stored.count)
        sendCallback(callbackId: callbackId, data: [:])
    }

    private func sendCallback(callbackId: String, data: [String: Any]) {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: data),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            NSLog("[FuriFuri] Failed to serialize callback data")
            return
        }

        // callbackId をエスケープ
        let escapedId = callbackId.replacingOccurrences(of: "'", with: "\\'")
        let js = "window._storageResolve('\(escapedId)', \(jsonString))"
        self.webView.evaluateJavaScript(js) { _, error in
            if let error = error {
                NSLog("[FuriFuri] evaluateJavaScript error: %@", error.localizedDescription)
            }
        }
    }

    // MARK: - 注入スクリプト

    /// browser.storage.local ポリフィル
    private static let storageBridgeJS = """
    (function() {
        if (typeof browser !== 'undefined') return;

        var _cbs = {};
        var _id = 0;

        window._storageResolve = function(id, data) {
            if (_cbs[id]) {
                _cbs[id](data);
                delete _cbs[id];
            }
        };

        window.browser = {
            storage: {
                local: {
                    get: function(defaults) {
                        return new Promise(function(resolve) {
                            var id = String(++_id);
                            _cbs[id] = resolve;
                            window.webkit.messageHandlers.controller.postMessage({
                                action: 'storageGet',
                                callbackId: id,
                                defaults: defaults || {}
                            });
                        });
                    },
                    set: function(data) {
                        return new Promise(function(resolve) {
                            var id = String(++_id);
                            _cbs[id] = resolve;
                            window.webkit.messageHandlers.controller.postMessage({
                                action: 'storageSet',
                                callbackId: id,
                                data: data || {}
                            });
                        });
                    }
                }
            }
        };
    })();
    """

    /// 戻るボタン注入スクリプト
    private static let backButtonJS = """
    document.addEventListener('DOMContentLoaded', function() {
        var header = document.querySelector('.header');
        if (header) {
            var back = document.createElement('button');
            back.textContent = '\\u2190 \\u623B\\u308B';
            back.className = 'btn-reset';
            back.style.marginInlineEnd = '8px';
            back.addEventListener('click', function() {
                window.webkit.messageHandlers.controller.postMessage({ action: 'goBack' });
            });
            header.insertBefore(back, header.firstChild);
        }
    });
    """
}
