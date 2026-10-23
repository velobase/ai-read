import ExpoModulesCore
import Foundation
import UIKit
import CryptoKit
import Darwin

private let inboxChanged = Notification.Name("com.velobase.bypage.document-inbox.changed")
private let bookLimit = 30 * 1024 * 1024
private let jsonLimit = 50 * 1024 * 1024
private let inboxLimit = 150 * 1024 * 1024
private let itemLimit = 5
private let supportedExtensions: Set<String> = ["pdf", "epub", "txt", "json"]

private enum InboxFailure: String, Error {
  case limit, unsupported, read
}

private func publicFailure() -> NSError {
  // System NSError descriptions can contain the originating filename or path.
  NSError(domain: "ByPageDocuments", code: 1, userInfo: [NSLocalizedDescriptionKey: "document_inbox_read"])
}

private struct InboxItem: Codable {
  let version: Int
  let id: String
  let name: String
  let ext: String
  let size: Int
  let createdAt: Double

  func payload(in root: URL) -> URL {
    root.appendingPathComponent(id, isDirectory: true).appendingPathComponent("document." + ext)
  }

  func publicData(in root: URL) -> [String: Any] {
    ["id": id, "name": name, "uri": payload(in: root).absoluteString, "size": size, "createdAt": createdAt]
  }
}

private func validID(_ value: String) -> Bool {
  UUID(uuidString: value)?.uuidString.lowercased() == value
}

private func regularFile(_ url: URL, maximum: Int) throws -> Int {
  var info = stat()
  guard lstat(url.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
        info.st_size >= 0, info.st_size <= maximum else { throw InboxFailure.read }
  return Int(info.st_size)
}

private func privateDirectory(_ url: URL, create: Bool) throws {
  if create {
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication, .posixPermissions: 0o700])
  }
  var info = stat()
  guard lstat(url.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR else { throw InboxFailure.read }
  try protect(url)
}

private func protect(_ url: URL) throws {
  try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
  var mutable = url
  var values = URLResourceValues()
  values.isExcludedFromBackup = true
  try mutable.setResourceValues(values)
}

private final class DocumentInbox {
  static let shared = DocumentInbox()
  let queue = DispatchQueue(label: "com.velobase.bypage.document-inbox", qos: .userInitiated)
  private let lock = NSLock()
  // These contain only transient digests, never persisted originating URLs.
  private var copying: Set<String> = []
  private var recent: [String: TimeInterval] = [:]
  // Queue-confined, transient fingerprints also catch a cold/scene callback
  // whose provider URL differs from the first callback for the same bytes.
  private var recentContent: [String: TimeInterval] = [:]
  private var lastError: InboxFailure?
  private var notificationPending = false
  private var preparedRoot: URL?

  /// Called synchronously from AppDelegate, including before React Native exists.
  @discardableResult
  func receive(_ source: URL) -> Bool {
    guard source.isFileURL else { return false }
    guard source.host == nil || source.host == "" || source.host == "localhost",
          source.query == nil, source.fragment == nil,
          source.user == nil, source.password == nil,
          source.path.hasPrefix("/"), !source.path.contains("\0"), source.path.utf8.count <= 8192,
          supportedExtensions.contains(source.pathExtension.lowercased()) else {
      recordError(.unsupported)
      return true
    }
    let key = SHA256.hash(data: Data(source.standardizedFileURL.absoluteString.utf8))
      .map { String(format: "%02x", $0) }.joined()
    let now = ProcessInfo.processInfo.systemUptime
    lock.lock()
    // A launch option and openURL callback may deliver the same document twice.
    // This is intentionally short lived: later explicit imports remain possible.
    recent = recent.filter { now - $0.value < 3 }
    if copying.contains(key) || recent[key] != nil {
      lock.unlock()
      return true
    }
    guard copying.count < itemLimit else {
      lock.unlock()
      recordError(.limit)
      return true
    }
    copying.insert(key)
    lock.unlock()

    // Acquire access before returning the OS callback; release after coordination.
    // A sandbox Inbox URL may be readable even when this returns false.
    let scoped = source.startAccessingSecurityScopedResource()
    queue.async {
      var succeeded = false
      defer {
        if scoped { source.stopAccessingSecurityScopedResource() }
        self.lock.lock()
        self.copying.remove(key)
        if succeeded {
          if self.recent.count >= 32 { self.recent.removeAll() }
          self.recent[key] = ProcessInfo.processInfo.systemUptime
        }
        self.lock.unlock()
      }
      do {
        let added = try self.capture(source)
        succeeded = true
        if added { self.notify() }
      } catch {
        self.recordError((error as? InboxFailure) ?? .read)
      }
    }
    return true
  }

  private func notify() {
    lock.lock()
    if notificationPending { lock.unlock(); return }
    notificationPending = true
    lock.unlock()
    DispatchQueue.main.async {
      self.lock.lock()
      self.notificationPending = false
      self.lock.unlock()
      NotificationCenter.default.post(name: inboxChanged, object: nil)
    }
  }

  private func recordError(_ error: InboxFailure) {
    lock.lock()
    lastError = error
    lock.unlock()
    notify()
  }

  func takeError() -> String? {
    lock.lock()
    defer { lock.unlock() }
    let error = lastError
    lastError = nil
    return error?.rawValue
  }

  // Every disk operation runs on `queue`; capture, list, recovery and dismissal
  // cannot race one another or evict a document whose preview is still open.
  private func root() throws -> URL {
    if let preparedRoot { return preparedRoot }
    let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let root = support.appendingPathComponent("document-inbox-v1", isDirectory: true)
    try privateDirectory(root, create: true)
    // Recover a completely written staging item after an interruption. An item
    // without its final metadata was never committed and contains a partial copy.
    for entry in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
      let name = entry.lastPathComponent
      guard name.hasSuffix(".pending") else { continue }
      let id = String(name.dropLast(".pending".count))
      guard validID(id) else { continue }
      try privateDirectory(entry, create: false)
      if (try? readItem(directory: entry, id: id)) != nil {
        let final = root.appendingPathComponent(id, isDirectory: true)
        if !FileManager.default.fileExists(atPath: final.path) {
          try FileManager.default.moveItem(at: entry, to: final)
        }
      } else {
        // Only our uncommitted staging copies are cleaned up. Committed items
        // have no expiration and are removed exclusively by dismiss(id).
        try FileManager.default.removeItem(at: entry)
      }
    }
    preparedRoot = root
    return root
  }

  private func readItem(directory: URL, id: String) throws -> InboxItem {
    try privateDirectory(directory, create: false)
    let metadata = directory.appendingPathComponent("metadata.json")
    _ = try regularFile(metadata, maximum: 4096)
    let item = try JSONDecoder().decode(InboxItem.self, from: Data(contentsOf: metadata))
    guard item.version == 1, item.id == id, validID(item.id), supportedExtensions.contains(item.ext),
          !item.name.isEmpty, item.name.count <= 180, item.name.utf8.count <= 1000,
          item.createdAt.isFinite, item.createdAt > 0,
          item.size > 0, item.size <= (item.ext == "json" ? jsonLimit : bookLimit) else { throw InboxFailure.read }
    let document = directory.appendingPathComponent("document." + item.ext)
    guard try regularFile(document, maximum: item.ext == "json" ? jsonLimit : bookLimit) == item.size else { throw InboxFailure.read }
    return item
  }

  private func items(in root: URL) throws -> [InboxItem] {
    var items: [InboxItem] = []
    for entry in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
      let id = entry.lastPathComponent
      guard validID(id) else { continue }
      // A corrupt committed item is retained, and fails closed rather than being
      // omitted from the capacity calculation and silently growing the inbox.
      items.append(try readItem(directory: entry, id: id))
    }
    guard items.count <= itemLimit, items.reduce(0, { $0 + $1.size }) <= inboxLimit else { throw InboxFailure.limit }
    return items.sorted { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }
  }

  func list() throws -> [[String: Any]] {
    do {
      let root = try root()
      return try items(in: root).map { $0.publicData(in: root) }
    } catch {
      // A failed refresh is not a new inbox event. Emitting inboxChanged here
      // would make a listener refresh a corrupt inbox in an endless loop.
      throw publicFailure()
    }
  }

  func dismiss(_ id: String) throws {
    guard validID(id) else { throw publicFailure() }
    do {
      let folder = try root().appendingPathComponent(id, isDirectory: true)
      if FileManager.default.fileExists(atPath: folder.path) {
        try privateDirectory(folder, create: false)
        try FileManager.default.removeItem(at: folder)
        notify()
      }
    } catch {
      recordError(.read)
      throw publicFailure()
    }
  }

  private func capture(_ source: URL) throws -> Bool {
    let root = try root()
    let existing = try items(in: root)
    guard existing.count < itemLimit else { throw InboxFailure.limit }
    let remaining = inboxLimit - existing.reduce(0, { $0 + $1.size })
    let ext = source.pathExtension.lowercased()
    let limit = min(remaining, ext == "json" ? jsonLimit : bookLimit)
    guard limit > 0 else { throw InboxFailure.limit }
    let id = UUID().uuidString.lowercased()
    let staging = root.appendingPathComponent(id + ".pending", isDirectory: true)
    try privateDirectory(staging, create: true)
    var committed = false
    defer { if !committed { try? FileManager.default.removeItem(at: staging) } }
    let destination = staging.appendingPathComponent("document." + ext)
    var coordinationError: NSError?
    var copyResult: Result<(size: Int, digest: String), Error>?
    let coordinator = NSFileCoordinator(filePresenter: nil)
    try checkSourceLeaf(source)
    coordinator.coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinationError) { coordinated in
      copyResult = Result {
        // Check the original leaf too: coordination must not turn a symlink
        // supplied as a document into a permitted regular-file target. A file
        // provider may legitimately move it while coordinating, so ENOENT is
        // allowed here; the coordinated file still needs O_NOFOLLOW + fstat.
        try self.checkSourceLeaf(source)
        return try self.copyBounded(coordinated, to: destination, limit: limit)
      }
    }
    guard coordinationError == nil, let copyResult else { throw InboxFailure.read }
    let copy = try copyResult.get()
    let base = source.deletingPathExtension().lastPathComponent.unicodeScalars
      .filter { !CharacterSet.controlCharacters.contains($0) && !["/", "\\"].contains(String($0)) }
    let cleaned = String(String.UnicodeScalarView(base)).trimmingCharacters(in: .whitespacesAndNewlines)
    // Bound scalars rather than grapheme clusters (one grapheme can contain an
    // unbounded number of combining marks), while preserving the extension.
    let name = String(String.UnicodeScalarView((cleaned.isEmpty ? "Document" : cleaned).unicodeScalars.prefix(160))) + "." + ext
    let signature = SHA256.hash(data: Data([name, ext, String(copy.size), copy.digest].joined(separator: "\0").utf8))
      .map { String(format: "%02x", $0) }.joined()
    let now = ProcessInfo.processInfo.systemUptime
    recentContent = recentContent.filter { now - $0.value < 3 }
    // Only a just-committed matching item suppresses publication. The defer
    // removes this new staging copy; existing items and sources stay untouched.
    if recentContent[signature] != nil { return false }
    let item = InboxItem(version: 1, id: id, name: name, ext: ext, size: copy.size, createdAt: Date().timeIntervalSince1970 * 1000)
    let metadata = staging.appendingPathComponent("metadata.json")
    try JSONEncoder().encode(item).write(to: metadata, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    try protect(metadata)
    // Metadata is the commit marker. Publish only after both durable files are
    // in an atomically renamed UUID directory, never a half-copied pathname.
    try FileManager.default.moveItem(at: staging, to: root.appendingPathComponent(id, isDirectory: true))
    committed = true
    if recentContent.count >= 32 { recentContent.removeAll() }
    recentContent[signature] = ProcessInfo.processInfo.systemUptime
    return true
  }

  private func checkSourceLeaf(_ source: URL) throws {
    var info = stat()
    if lstat(source.path, &info) == 0 {
      guard (info.st_mode & S_IFMT) == S_IFREG else { throw InboxFailure.read }
    } else if errno != ENOENT {
      throw InboxFailure.read
    }
  }

  private func copyBounded(_ source: URL, to destination: URL, limit: Int) throws -> (size: Int, digest: String) {
    let input = open(source.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    guard input >= 0 else { throw InboxFailure.read }
    defer { close(input) }
    var info = stat()
    guard fstat(input, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else { throw InboxFailure.read }
    guard info.st_size > 0, info.st_size <= limit else { throw InboxFailure.limit }
    let output = open(destination.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard output >= 0 else { throw InboxFailure.read }
    defer { close(output) }
    try protect(destination)
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    var digest = SHA256()
    var total = 0
    while true {
      let count = buffer.withUnsafeMutableBytes { Darwin.read(input, $0.baseAddress, $0.count) }
      if count < 0 {
        if errno == EINTR { continue }
        throw InboxFailure.read
      }
      if count == 0 { break }
      guard count <= limit - total else { throw InboxFailure.limit }
      var written = 0
      while written < count {
        let amount = buffer.withUnsafeBytes { Darwin.write(output, $0.baseAddress!.advanced(by: written), count - written) }
        if amount < 0 && errno == EINTR { continue }
        guard amount > 0 else { throw InboxFailure.read }
        written += amount
      }
      digest.update(data: Data(buffer.prefix(count)))
      total += count
    }
    // Reject a source that changed length despite coordinated reading.
    guard total > 0, total == info.st_size, fsync(output) == 0 else { throw InboxFailure.read }
    return (total, digest.finalize().map { String(format: "%02x", $0) }.joined())
  }
}

public final class ByPageDocumentsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let key = UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsURLKey")
    if let url = launchOptions?[key] as? URL { DocumentInbox.shared.receive(url) }
    return true
  }

  public func application(_ app: UIApplication, open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    // ExpoAppSceneDelegate also forwards cold connectionOptions / warm scene
    // URL contexts here; persistence does not depend on a live JS listener.
    DocumentInbox.shared.receive(url)
  }
}

public final class ByPageDocumentsModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ByPageDocuments")
    Constant("version") { 1 }
    Events("inboxChanged")
    OnCreate {
      self.observer = NotificationCenter.default.addObserver(forName: inboxChanged, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("inboxChanged", [:])
      }
    }
    OnDestroy {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
    }
    AsyncFunction("listPending") { () throws -> [[String: Any]] in try DocumentInbox.shared.list() }
      .runOnQueue(DocumentInbox.shared.queue)
    AsyncFunction("dismiss") { (id: String) throws in try DocumentInbox.shared.dismiss(id) }
      .runOnQueue(DocumentInbox.shared.queue)
    AsyncFunction("takeError") { () -> String? in DocumentInbox.shared.takeError() }
      .runOnQueue(DocumentInbox.shared.queue)
  }
}
