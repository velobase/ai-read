import ExpoModulesCore
import AuthenticationServices
import Security
import CryptoKit
import UIKit
import GoogleSignIn

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
  let permissions: [String]
}

private struct StoredAuthSession: Codable {
  let version: Int
  let origin: String
  let token: String
  let expiresAt: String
  let user: AuthUser
  let sessionId: String
  let permissions: [String]
  let provider: String
  let providerSubject: String
  var grantedPermissions: [String] { permissions }

  var valid: Bool {
    version == 2 && validToken(token) && user.valid && validIdentity(sessionId)
      && ["apple", "google"].contains(provider) && !providerSubject.isEmpty && providerSubject.utf8.count <= 255
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

private struct NativeChallenge: Decodable {
  let challenge: String
  let nonce: String
  let googleClientId: String?
  let googleServerClientId: String?
}

private final class AppleAuthorization: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  let window: UIWindow
  let completion: (ASAuthorizationAppleIDCredential?, String?) -> Void
  init(window: UIWindow, completion: @escaping (ASAuthorizationAppleIDCredential?, String?) -> Void) {
    self.window = window
    self.completion = completion
  }
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { window }
  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    completion(authorization.credential as? ASAuthorizationAppleIDCredential, nil)
  }
  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    let cancelled = (error as NSError).domain == ASAuthorizationError.errorDomain
      && (error as NSError).code == ASAuthorizationError.canceled.rawValue
    completion(nil, cancelled ? "auth_cancelled" : "auth_sign_in_failed")
  }
}

private final class AuthFlow {
  let id = UUID()
  let origin: String
  let state: String
  let verifier: String
  let operation: String
  let promise: Promise
  let original: StoredAuthSession?
  var provider: String?
  var providerSubject: String?
  var appleDelegate: AppleAuthorization?
  var appleController: ASAuthorizationController?
  var exchange: AuthHTTPTask?
  var timeout: DispatchWorkItem?
  init(origin: String, operation: String, promise: Promise, original: StoredAuthSession? = nil) throws {
    self.origin = origin
    self.operation = operation
    self.promise = promise
    self.original = original
    self.state = try randomSecret()
    self.verifier = try randomSecret()
    self.provider = original?.provider
    self.providerSubject = original?.providerSubject
  }
}

public final class ByPageAuthAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ app: UIApplication, open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    GIDSignIn.sharedInstance.handle(url)
  }
}

public final class ByPageAuthModule: Module {
  // Lifecycle actions and HTTP completions run on the main queue. No credential crosses the JS bridge.
  private var pending: AuthFlow?
  private var revocations: [UUID: AuthHTTPTask] = [:]

  public func definition() -> ModuleDefinition {
    Name("ByPageAuth")
    AsyncFunction("signInWithProvider") { (origin: String, provider: String, promise: Promise) in
      self.startSignIn(origin, provider: provider, promise: promise)
    }.runOnQueue(.main)
    AsyncFunction("signInLibrary") { (origin: String, expectedSessionID: String, promise: Promise) in
      self.sessionOperation(origin, expectedSessionID: expectedSessionID, operation: "library", promise: promise)
    }.runOnQueue(.main)
    AsyncFunction("renewSession") { (origin: String, expectedSessionID: String, promise: Promise) in
      self.sessionOperation(origin, expectedSessionID: expectedSessionID, operation: "refresh", promise: promise)
    }.runOnQueue(.main)
    AsyncFunction("readSession") { (origin: String) -> [String: Any]? in
      // Restore the LeafRead session directly; provider cookies are never needed to reopen the app.
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
      GIDSignIn.sharedInstance.signOut()
    }.runOnQueue(.main)
    AsyncFunction("logout") { (origin: String, promise: Promise) in self.signOut(origin, promise: promise) }.runOnQueue(.main)
    OnDestroy {
      let cleanup = {
        self.cancelPending()
        let requests = Array(self.revocations.values)
        self.revocations.removeAll()
        for request in requests { request.cancel() }
      }
      if Thread.isMainThread { cleanup() } else { DispatchQueue.main.async(execute: cleanup) }
    }
  }

  private func cancelPending() {
    guard let flow = pending else { return }
    pending = nil
    flow.timeout?.cancel()
    flow.exchange?.cancel()
    flow.promise.reject("auth_cancelled", "auth_cancelled")
  }
  private func fail(_ id: UUID, _ code: String) {
    guard let flow = pending, flow.id == id else { return }
    pending = nil
    flow.timeout?.cancel()
    flow.exchange?.cancel()
    flow.promise.reject(code, code)
  }
  private func begin(_ flow: AuthFlow, seconds: Double) {
    pending = flow
    let id = flow.id
    let timeout = DispatchWorkItem { [weak self] in self?.fail(id, "auth_timeout") }
    flow.timeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: timeout)
  }
  private func errorCode(_ response: AuthHTTPResponse, authenticated: Bool = false) -> String {
    if authenticated && response.status == 401 { return "native_session_expired" }
    let object = try? JSONSerialization.jsonObject(with: response.data) as? [String: Any]
    if let code = object?["error"] as? String,
       ["account_link_required", "signin_retry", "account_changed"].contains(code) { return code }
    return (400...499).contains(response.status) ? "auth_sign_in_failed" : "auth_unavailable"
  }
  private func startSignIn(_ input: String, provider: String, promise: Promise) {
    // A new user action fences any pending background renewal before credentials can change.
    cancelPending()
    do {
      guard ["apple", "google"].contains(provider) else { throw authFailure("invalid_provider") }
      let origin = try originForAuth(input)
      _ = try AuthKeychain.read(origin)
      guard let controller = appContext?.utilities?.currentViewController(),
            let window = controller.view.window, window.windowScene?.activationState == .foregroundActive else {
        throw authFailure("auth_presentation_unavailable")
      }
      let flow = try AuthFlow(origin: origin, operation: "signin", promise: promise)
      flow.provider = provider
      begin(flow, seconds: 300)
      var request = authRequest(origin, path: "/api/mobile/v1/auth/native/challenge", method: "POST")
      request.httpBody = try JSONSerialization.data(withJSONObject: ["provider": provider,
        "code_challenge": base64URL(Data(SHA256.hash(data: Data(flow.verifier.utf8))))])
      let task = AuthHTTPTask(request: request) { [weak self] result in
        guard let self, self.pending?.id == flow.id else { return }
        guard case .success(let response) = result else { self.fail(flow.id, "auth_network_error"); return }
        guard response.status == 200 else { self.fail(flow.id, self.errorCode(response)); return }
        guard let challenge = try? JSONDecoder().decode(NativeChallenge.self, from: response.data),
              validToken(challenge.nonce), challenge.challenge.utf8.count <= 2048 else {
          self.fail(flow.id, "invalid_auth_response"); return
        }
        flow.exchange = nil
        self.presentProvider(flow, challenge: challenge, controller: controller, window: window)
      }
      flow.exchange = task
      task.start()
    } catch { let code = (error as NSError).localizedDescription; promise.reject(code, code) }
  }

  private func presentProvider(_ flow: AuthFlow, challenge: NativeChallenge, controller: UIViewController, window: UIWindow) {
    guard pending?.id == flow.id, window.windowScene?.activationState == .foregroundActive else {
      fail(flow.id, "auth_presentation_unavailable"); return
    }
    if flow.provider == "apple" {
      let request = ASAuthorizationAppleIDProvider().createRequest()
      request.requestedScopes = [.fullName, .email]
      request.nonce = challenge.nonce
      request.state = flow.state
      let delegate = AppleAuthorization(window: window) { [weak self, weak flow] credential, error in
        DispatchQueue.main.async {
          guard let self, let flow, self.pending?.id == flow.id else { return }
          if let error { self.fail(flow.id, error); return }
          guard let credential, credential.state == flow.state,
                let data = credential.identityToken, let identity = String(data: data, encoding: .utf8),
                let codeData = credential.authorizationCode, let code = String(data: codeData, encoding: .utf8) else {
            self.fail(flow.id, "invalid_auth_response"); return
          }
          flow.providerSubject = credential.user
          var body = ["identityToken": identity, "authorizationCode": code]
          if let name = credential.fullName { body["name"] = PersonNameComponentsFormatter().string(from: name) }
          self.exchangeProvider(flow, challenge: challenge, body: body)
        }
      }
      let authorization = ASAuthorizationController(authorizationRequests: [request])
      authorization.delegate = delegate
      authorization.presentationContextProvider = delegate
      flow.appleDelegate = delegate
      flow.appleController = authorization
      authorization.performRequests()
    } else {
      guard let client = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
            let server = Bundle.main.object(forInfoDictionaryKey: "GIDServerClientID") as? String,
            client == challenge.googleClientId, server == challenge.googleServerClientId else {
        fail(flow.id, "auth_configuration_mismatch"); return
      }
      GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: client, serverClientID: server)
      GIDSignIn.sharedInstance.signIn(withPresenting: controller, hint: nil, additionalScopes: nil, nonce: challenge.nonce) { [weak self] result, error in
        guard let self, self.pending?.id == flow.id else { return }
        if let error {
          self.fail(flow.id, (error as NSError).code == -5 ? "auth_cancelled" : "auth_sign_in_failed"); return
        }
        guard let user = result?.user, let identity = user.idToken?.tokenString, let subject = user.userID else {
          self.fail(flow.id, "invalid_auth_response"); return
        }
        flow.providerSubject = subject
        self.exchangeProvider(flow, challenge: challenge, body: ["identityToken": identity])
      }
    }
  }
  private func exchangeProvider(_ flow: AuthFlow, challenge: NativeChallenge, body: [String: String]) {
    guard pending?.id == flow.id else { return }
    do {
      var payload = body
      payload["provider"] = flow.provider
      payload["challenge"] = challenge.challenge
      payload["code_verifier"] = flow.verifier
      var request = authRequest(flow.origin, path: "/api/mobile/v1/auth/native/token", method: "POST")
      request.httpBody = try JSONSerialization.data(withJSONObject: payload)
      let task = AuthHTTPTask(request: request) { [weak self] result in self?.receivedToken(flow.id, result: result) }
      flow.exchange = task
      task.start()
    } catch { fail(flow.id, "auth_sign_in_failed") }
  }
  private func sessionOperation(_ input: String, expectedSessionID: String, operation: String, promise: Promise) {
    do {
      guard pending == nil else { throw authFailure("auth_busy") }
      let origin = try originForAuth(input)
      guard let stored = try AuthKeychain.read(origin), stored.sessionId == expectedSessionID else {
        throw authFailure("native_session_expired")
      }
      let flow = try AuthFlow(origin: origin, operation: operation, promise: promise, original: stored)
      begin(flow, seconds: 30)
      if operation == "refresh", stored.provider == "apple" {
        let subject = stored.providerSubject
        ASAuthorizationAppleIDProvider().getCredentialState(forUserID: subject) { [weak self] state, error in
          DispatchQueue.main.async {
            guard let self, self.pending?.id == flow.id else { return }
            if error == nil && (state == .revoked || state == .notFound) {
              self.fail(flow.id, "native_session_expired"); return
            }
            self.sendSessionOperation(flow)
          }
        }
      } else { sendSessionOperation(flow) }
    } catch { let code = (error as NSError).localizedDescription; promise.reject(code, code) }
  }
  private func sendSessionOperation(_ flow: AuthFlow) {
    guard pending?.id == flow.id, let stored = flow.original else { return }
    do {
      var request = authRequest(flow.origin, path: "/api/mobile/v1/auth/native/" + flow.operation, method: "POST")
      request.setValue("Bearer \(stored.token)", forHTTPHeaderField: "Authorization")
      request.httpBody = try JSONSerialization.data(withJSONObject: flow.operation == "library"
        ? ["confirmation": stored.user.id, "permission": "library_sync"] : [:])
      let task = AuthHTTPTask(request: request) { [weak self] result in self?.receivedToken(flow.id, result: result) }
      flow.exchange = task
      task.start()
    } catch { fail(flow.id, "auth_sign_in_failed") }
  }
  private func receivedToken(_ id: UUID, result: Result<AuthHTTPResponse, Error>) {
    guard let flow = pending, flow.id == id else { return }
    guard case .success(let response) = result else { fail(id, "auth_network_error"); return }
    guard response.status == 200 else { fail(id, errorCode(response, authenticated: flow.original != nil)); return }
    guard let exchange = try? JSONDecoder().decode(TokenExchange.self, from: response.data),
          let expiry = authDate(exchange.expires), expiry > Date(), expiry.timeIntervalSinceNow <= 31 * 24 * 60 * 60 else {
      fail(id, "invalid_auth_response"); return
    }
    let permissions = exchange.permissions
    let expected = flow.operation == "library" ? libraryPermissions : flow.original?.grantedPermissions ?? aiPermissions
    guard validPermissions(permissions), Set(permissions) == Set(expected) else {
      fail(id, "invalid_auth_permissions"); return
    }
    do {
      if let original = flow.original {
        // Late callbacks cannot restore a signed-out account or overwrite a newer credential.
        guard let current = try AuthKeychain.read(flow.origin), current.token == original.token,
              current.sessionId == original.sessionId, current.user.id == original.user.id,
              exchange.sessionId == original.sessionId, exchange.user.id == original.user.id else {
          fail(id, "account_changed"); return
        }
      }
      guard let provider = flow.provider, let subject = flow.providerSubject else {
        fail(id, "invalid_auth_response"); return
      }
      let session = StoredAuthSession(version: 2, origin: flow.origin, token: exchange.token,
        expiresAt: exchange.expires, user: exchange.user, sessionId: exchange.sessionId,
        permissions: permissions, provider: provider, providerSubject: subject)
      guard session.valid else { fail(id, "invalid_auth_response"); return }
      try AuthKeychain.save(session)
      pending = nil
      flow.timeout?.cancel()
      flow.promise.resolve(session.publicData)
    } catch { fail(id, "auth_storage_unavailable") }
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
      try AuthKeychain.remove(origin)
      GIDSignIn.sharedInstance.signOut()
      guard let stored else { promise.resolve(["revoked": true]); return }
      var request = authRequest(origin, path: "/api/mobile/v1/auth/native/session", method: "DELETE")
      request.setValue("Bearer \(stored.token)", forHTTPHeaderField: "Authorization")
      let id = UUID()
      let task = AuthHTTPTask(request: request) { [weak self] result in
        self?.revocations.removeValue(forKey: id)
        let revoked: Bool
        if case .success(let response) = result { revoked = (200...299).contains(response.status) || response.status == 401 }
        else { revoked = false }
        promise.resolve(["revoked": revoked])
      }
      revocations[id] = task
      task.start()
    } catch { promise.reject("auth_storage_unavailable", "auth_storage_unavailable") }
  }
}
