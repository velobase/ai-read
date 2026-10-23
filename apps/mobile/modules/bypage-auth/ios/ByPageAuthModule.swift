import ExpoModulesCore
import AuthenticationServices
import Security
import CryptoKit
import UIKit

private let authCallbackScheme = "com.velobase.bypage"
private let authService = "com.velobase.bypage.native-auth.v1"

private func authFailure(_ code: String) -> NSError {
  // Never include callback URLs, response bodies, credentials or system error descriptions.
  NSError(domain: "ByPageAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: code])
}

private func originForAuth(_ input: String) throws -> String {
  guard input.count <= 2000, input == input.trimmingCharacters(in: .whitespacesAndNewlines),
        var parts = URLComponents(string: input),
        let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased(), !host.isEmpty,
        parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
        parts.path.isEmpty || parts.path == "/", !input.contains("\\"),
        parts.port.map({ (1...65535).contains($0) }) ?? true else {
    throw authFailure("invalid_server_origin")
  }
  var localHTTP = false
#if DEBUG
  localHTTP = Bundle.main.object(forInfoDictionaryKey: "ByPageAuthAllowLocalHTTP") as? Bool == true
    && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host) && scheme == "http"
#endif
  guard scheme == "https" || localHTTP else { throw authFailure("invalid_server_origin") }
  parts.scheme = scheme
  parts.host = host
  parts.path = ""
  if parts.port == (scheme == "https" ? 443 : 80) { parts.port = nil }
  guard let origin = parts.url?.absoluteString else { throw authFailure("invalid_server_origin") }
  var allowedOrigin = "https://leafread.ai"
#if DEBUG
  if let configured = Bundle.main.object(forInfoDictionaryKey: "ByPageServiceOrigin") as? String,
     let target = URLComponents(string: configured),
     ["localhost", "127.0.0.1", "::1", "[::1]"].contains(target.host?.lowercased() ?? ""),
     ["https", "http"].contains(target.scheme ?? "") {
    allowedOrigin = configured
  }
#endif
  guard origin == allowedOrigin else { throw authFailure("unsupported_service_origin") }
  return origin
}

private func base64URL(_ data: Data) -> String {
  data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

private func randomSecret() throws -> String {
  var bytes = [UInt8](repeating: 0, count: 32)
  guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
    throw authFailure("auth_random_unavailable")
  }
  return base64URL(Data(bytes))
}

private func validToken(_ value: String) -> Bool {
  value.utf8.count == 43 && value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
}

private func validIdentity(_ value: String) -> Bool {
  value.utf8.count <= 200 && !["__proto__", "constructor", "prototype"].contains(value)
    && value.range(of: "^[A-Za-z0-9_.:-]{1,200}$", options: .regularExpression) != nil
}

private let aiPermissions = ["account_ai"]
private let libraryPermissions = ["account_ai", "library_sync"]
private func validPermissions(_ value: [String]) -> Bool {
  value.contains("account_ai") && value.count <= libraryPermissions.count
    && Set(value).count == value.count && value.allSatisfy { libraryPermissions.contains($0) }
}

private func authDate(_ value: String) -> Date? {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.date(from: value)
}

private struct AuthUser: Codable {
  let id: String
  let name: String?
  let email: String
  let image: String?
  let bio: String?
  let color: String?
  let createdAt: String?

  var valid: Bool {
    validIdentity(id) && !email.isEmpty && email.utf8.count <= 320
      && (name?.utf8.count ?? 0) <= 1000 && (image?.utf8.count ?? 0) <= 4000
      && (bio?.utf8.count ?? 0) <= 4000 && (color?.utf8.count ?? 0) <= 100
      && (createdAt?.utf8.count ?? 0) <= 100
  }

  var publicData: [String: Any] {
    var result: [String: Any] = ["id": id, "name": name ?? email, "email": email, "image": image as Any? ?? NSNull()]
    if let bio { result["bio"] = bio }
    if let color { result["color"] = color }
    if let createdAt { result["createdAt"] = createdAt }
    return result
  }
}

private struct TokenExchange: Decodable {
  let token: String
  let expires: String
  let user: AuthUser
  let sessionId: String
  let permissions: [String]?
}

private struct StoredAuthSession: Codable {
  let version: Int
  let origin: String
  let token: String
  let expiresAt: String
  let user: AuthUser
  let sessionId: String
  // Missing in a legacy v1 Keychain item; it can only mean AI permission.
  let permissions: [String]?
  var grantedPermissions: [String] { permissions ?? aiPermissions }

  var valid: Bool {
    version == 1 && validToken(token) && user.valid && validIdentity(sessionId)
      && validPermissions(grantedPermissions)
      && authDate(expiresAt) != nil
  }

  var publicData: [String: Any] {
    ["origin": origin, "user": user.publicData, "sessionId": sessionId, "expiresAt": expiresAt, "permissions": grantedPermissions]
  }
}

private enum AuthKeychain {
  static func query(_ origin: String) -> [String: Any] {
    let account = SHA256.hash(data: Data(origin.utf8)).map { String(format: "%02x", $0) }.joined()
    return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: authService,
            kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false]
  }

  static func remove(_ origin: String) throws {
    let status = SecItemDelete(query(origin) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw authFailure("auth_storage_unavailable")
    }
  }

  static func read(_ origin: String) throws -> StoredAuthSession? {
    var lookup = query(origin)
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(lookup as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw authFailure("auth_storage_unavailable") }
    guard let data = result as? Data, data.count <= 16 * 1024,
          let session = try? JSONDecoder().decode(StoredAuthSession.self, from: data),
          session.valid, session.origin == origin,
          let expiry = authDate(session.expiresAt), expiry > Date() else {
      try remove(origin)
      return nil
    }
    return session
  }

  static func save(_ session: StoredAuthSession) throws {
    let data = try JSONEncoder().encode(session)
    guard session.valid, data.count <= 16 * 1024 else { throw authFailure("invalid_auth_response") }
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    let lookup = query(session.origin)
    var status = SecItemUpdate(lookup as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(lookup.merging(attributes, uniquingKeysWith: { _, value in value }) as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw authFailure("auth_storage_unavailable") }
  }
}

private struct AuthHTTPResponse {
  let status: Int
  let data: Data
}

/** Small auth JSON only. The existing Expo transport owns reading/AI streaming. */
private final class AuthHTTPTask: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private var completion: ((Result<AuthHTTPResponse, Error>) -> Void)?
  private var session: URLSession?
  private var task: URLSessionDataTask?
  private var data = Data()
  private var status = 0
  private let url: URL
  private let limit = 64 * 1024

  init(request: URLRequest, completion: @escaping (Result<AuthHTTPResponse, Error>) -> Void) {
    self.url = request.url!
    self.completion = completion
    super.init()
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.urlCredentialStorage = nil
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 20
    config.waitsForConnectivity = false
    let session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
    self.session = session
    self.task = session.dataTask(with: request)
  }

  func start() { task?.resume() }
  func cancel() { finish(.failure(authFailure("auth_cancelled"))) }

  private func finish(_ result: Result<AuthHTTPResponse, Error>) {
    guard let callback = completion else { return }
    completion = nil
    session?.invalidateAndCancel()
    session = nil
    task = nil
    callback(result)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask,
                  willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                  completionHandler: @escaping (URLRequest?) -> Void) {
    // Neither authorization codes nor Bearer credentials may follow a redirect.
    completionHandler(nil)
    finish(.failure(authFailure("auth_redirect_rejected")))
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    guard let response = response as? HTTPURLResponse, response.url == url,
          response.expectedContentLength <= Int64(limit) else {
      completionHandler(.cancel)
      finish(.failure(authFailure("invalid_auth_response")))
      return
    }
    status = response.statusCode
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
    guard completion != nil else { return }
    guard data.count + chunk.count <= limit else {
      finish(.failure(authFailure("invalid_auth_response")))
      return
    }
    data.append(chunk)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if error != nil { finish(.failure(authFailure("auth_network_error"))) }
    else { finish(.success(AuthHTTPResponse(status: status, data: data))) }
  }
}

private final class AuthPresentation: NSObject, ASWebAuthenticationPresentationContextProviding {
  private let window: UIWindow
  init(window: UIWindow) { self.window = window }
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { window }
}

private final class AuthFlow {
  let id = UUID()
  let origin: String
  let state: String
  let verifier: String
  let library: Bool
  let promise: Promise
  var browser: ASWebAuthenticationSession?
  var presentation: AuthPresentation?
  var exchange: AuthHTTPTask?
  var timeout: DispatchWorkItem?

  init(origin: String, state: String, verifier: String, library: Bool, promise: Promise) {
    self.origin = origin
    self.state = state
    self.verifier = verifier
    self.library = library
    self.promise = promise
  }
}

public final class ByPageAuthModule: Module {
  // Every lifecycle action and URLSession delegate callback is serialized on the main queue.
  private var pending: AuthFlow?
  private var revocations: [UUID: AuthHTTPTask] = [:]

  public func definition() -> ModuleDefinition {
    Name("ByPageAuth")
    Constant("version") { 2 }
    Constant("libraryVersion") { 1 }
    Constant("providerVersion") { 1 }

    AsyncFunction("signIn") { (origin: String, promise: Promise) in
      self.startSignIn(origin, library: false, provider: "google", promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("signInLibrary") { (origin: String, promise: Promise) in
      self.startSignIn(origin, library: true, provider: nil, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("signInWithProvider") { (origin: String, provider: String, promise: Promise) in
      guard ["apple", "google"].contains(provider) else {
        promise.reject("invalid_provider", "invalid_provider"); return
      }
      self.startSignIn(origin, library: false, provider: provider, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("readSession") { (origin: String) -> [String: Any]? in
      try AuthKeychain.read(originForAuth(origin))?.publicData
    }.runOnQueue(.main)

    AsyncFunction("authorization") { (origin: String, expectedSessionID: String) -> String? in
      guard let session = try AuthKeychain.read(originForAuth(origin)),
            session.sessionId == expectedSessionID else { return nil }
      return "Bearer \(session.token)"
    }.runOnQueue(.main)

    AsyncFunction("cancelSignIn") { self.cancelPending() }.runOnQueue(.main)

    AsyncFunction("clearSession") { (input: String, expectedSessionID: String?) in
      let origin = try originForAuth(input)
      if let expectedSessionID {
        guard let session = try AuthKeychain.read(origin), session.sessionId == expectedSessionID else { return }
      }
      if self.pending?.origin == origin { self.cancelPending() }
      try AuthKeychain.remove(origin)
    }.runOnQueue(.main)

    AsyncFunction("logout") { (origin: String, promise: Promise) in
      self.signOut(origin, promise: promise)
    }.runOnQueue(.main)

    OnDestroy {
      let cleanup = {
        self.cancelPending()
        let requests = Array(self.revocations.values)
        self.revocations.removeAll()
        for request in requests { request.cancel() }
      }
      if Thread.isMainThread { cleanup() }
      else { DispatchQueue.main.async(execute: cleanup) }
    }
  }

  private func cancelPending() {
    guard let flow = pending else { return }
    // Invalidate identity before cancelling: system/network completion can arrive synchronously.
    pending = nil
    flow.timeout?.cancel()
    flow.browser?.cancel()
    flow.exchange?.cancel()
    flow.promise.reject("auth_cancelled", "auth_cancelled")
  }

  private func fail(_ id: UUID, _ code: String) {
    guard let flow = pending, flow.id == id else { return }
    pending = nil
    flow.timeout?.cancel()
    flow.browser?.cancel()
    flow.exchange?.cancel()
    flow.promise.reject(code, code)
  }

  private func startSignIn(_ input: String, library: Bool, provider: String?, promise: Promise) {
    cancelPending()
    do {
      let origin = try originForAuth(input)
      // Fail before opening the browser if protected storage is temporarily locked/unavailable.
      _ = try AuthKeychain.read(origin)
      guard let window = appContext?.utilities?.currentViewController()?.view.window,
            window.windowScene?.activationState == .foregroundActive else {
        throw authFailure("auth_presentation_unavailable")
      }
      let flow = AuthFlow(origin: origin, state: try randomSecret(), verifier: try randomSecret(), library: library, promise: promise)
      let path = library ? "/mobile/library/authorize" : "/mobile/authorize"
      var authorize = URLComponents(string: origin + path)!
      authorize.queryItems = [
        URLQueryItem(name: "code_challenge", value: base64URL(Data(SHA256.hash(data: Data(flow.verifier.utf8))))),
        URLQueryItem(name: "state", value: flow.state),
      ]
      if let provider { authorize.queryItems?.append(URLQueryItem(name: "provider", value: provider)) }
      guard let url = authorize.url else { throw authFailure("invalid_server_origin") }
      let id = flow.id
      let callback: ASWebAuthenticationSession.CompletionHandler = { [weak self] url, error in
        DispatchQueue.main.async { self?.receivedCallback(id, url: url, error: error) }
      }
      let browser: ASWebAuthenticationSession
      if #available(iOS 17.4, *) {
        browser = ASWebAuthenticationSession(url: url, callback: .customScheme(authCallbackScheme), completionHandler: callback)
      } else {
        browser = ASWebAuthenticationSession(url: url, callbackURLScheme: authCallbackScheme, completionHandler: callback)
      }
      flow.presentation = AuthPresentation(window: window)
      browser.presentationContextProvider = flow.presentation
      // Explicit provider choices must not silently reuse or link a different browser identity.
      browser.prefersEphemeralWebBrowserSession = provider != nil
      flow.browser = browser
      let timeout = DispatchWorkItem { [weak self] in self?.fail(id, "auth_timeout") }
      flow.timeout = timeout
      pending = flow
      DispatchQueue.main.asyncAfter(deadline: .now() + 600, execute: timeout)
      if !browser.start() { fail(id, "auth_presentation_unavailable") }
    } catch {
      let code = (error as NSError).localizedDescription
      promise.reject(code, code)
    }
  }

  private func receivedCallback(_ id: UUID, url: URL?, error: Error?) {
    guard let flow = pending, flow.id == id else { return }
    if let error {
      let code = (error as NSError).domain == ASWebAuthenticationSessionErrorDomain
        && (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue
        ? "auth_cancelled" : "auth_sign_in_failed"
      fail(id, code)
      return
    }
    guard let url, url.absoluteString.utf8.count <= 8192,
          let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
          parts.scheme == authCallbackScheme, parts.percentEncodedHost == "auth", parts.percentEncodedPath == "/callback",
          parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
          let items = parts.queryItems, items.count <= 5 else {
      fail(id, "invalid_auth_callback")
      return
    }
    var params: [String: String] = [:]
    for item in items {
      guard ["code", "state", "issuer", "error"].contains(item.name),
            params[item.name] == nil, let value = item.value, value.utf8.count <= 2000 else {
        fail(id, "invalid_auth_callback")
        return
      }
      params[item.name] = value
    }
    guard params["state"] == flow.state, params["issuer"] == flow.origin else {
      fail(id, "invalid_auth_callback")
      return
    }
    if params["error"] != nil {
      fail(id, params["error"] == "access_denied" && params["code"] == nil ? "auth_cancelled" : "invalid_auth_callback")
      return
    }
    guard let code = params["code"], validToken(code), flow.exchange == nil else {
      fail(id, "invalid_auth_callback")
      return
    }
    do {
      var request = authRequest(flow.origin, path: "/api/mobile/v1/auth/token", method: "POST")
      request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code, "code_verifier": flow.verifier, "state": flow.state])
      let operation = AuthHTTPTask(request: request) { [weak self] result in
        self?.receivedToken(id, result: result)
      }
      flow.exchange = operation
      operation.start()
    } catch { fail(id, "auth_sign_in_failed") }
  }

  private func receivedToken(_ id: UUID, result: Result<AuthHTTPResponse, Error>) {
    guard let flow = pending, flow.id == id else { return }
    switch result {
    case .failure:
      fail(id, "auth_network_error")
    case .success(let response):
      guard response.status == 200 else {
        fail(id, response.status == 401 || response.status == 400 ? "auth_sign_in_failed" : "auth_unavailable")
        return
      }
      guard let exchange = try? JSONDecoder().decode(TokenExchange.self, from: response.data),
            let expiry = authDate(exchange.expires), expiry > Date(),
            expiry.timeIntervalSinceNow <= 31 * 24 * 60 * 60 else {
        fail(id, "invalid_auth_response")
        return
      }
      let permissions = exchange.permissions ?? aiPermissions
      // A library flow cannot silently accept an AI-only exchange, and an AI
      // flow cannot unexpectedly gain upload rights. Only the confirmed grant wins.
      guard validPermissions(permissions),
            Set(permissions) == Set(flow.library ? libraryPermissions : aiPermissions) else {
        fail(id, "invalid_auth_permissions")
        return
      }
      let session = StoredAuthSession(version: 1, origin: flow.origin, token: exchange.token,
                                      expiresAt: exchange.expires, user: exchange.user, sessionId: exchange.sessionId,
                                      permissions: flow.library ? libraryPermissions : aiPermissions)
      guard session.valid else { fail(id, "invalid_auth_response"); return }
      do {
        try AuthKeychain.save(session)
        // No suspension between the pending-flow check, the Keychain write and resolving identity.
        pending = nil
        flow.timeout?.cancel()
        flow.promise.resolve(session.publicData)
      } catch { fail(id, "auth_storage_unavailable") }
    }
  }

  private func authRequest(_ origin: String, path: String, method: String) -> URLRequest {
    var request = URLRequest(url: URL(string: origin + path)!)
    request.httpMethod = method
    request.timeoutInterval = 15
    request.httpShouldHandleCookies = false
    request.setValue(origin, forHTTPHeaderField: "Origin")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    return request
  }

  private func signOut(_ input: String, promise: Promise) {
    do {
      let origin = try originForAuth(input)
      if pending?.origin == origin { cancelPending() }
      let stored = try AuthKeychain.read(origin)
      // Removing local credentials does not depend on reaching the server.
      try AuthKeychain.remove(origin)
      guard let stored else { promise.resolve(["revoked": true]); return }
      var request = authRequest(origin, path: "/api/mobile/v1/auth/session", method: "DELETE")
      request.setValue("Bearer \(stored.token)", forHTTPHeaderField: "Authorization")
      let id = UUID()
      let operation = AuthHTTPTask(request: request) { [weak self] result in
        self?.revocations.removeValue(forKey: id)
        let revoked: Bool
        if case .success(let response) = result {
          revoked = (200...299).contains(response.status) || response.status == 401
        } else { revoked = false }
        promise.resolve(["revoked": revoked])
      }
      revocations[id] = operation
      operation.start()
    } catch { promise.reject("auth_storage_unavailable", "auth_storage_unavailable") }
  }
}
