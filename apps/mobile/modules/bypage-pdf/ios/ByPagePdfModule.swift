import ExpoModulesCore
import PDFKit
import Vision
import CoreGraphics
import CryptoKit
import UIKit

private enum PdfOriginals {
  static func failure(_ code: String) -> NSError {
    NSError(domain: "ByPagePDF", code: 1, userInfo: [NSLocalizedDescriptionKey: code])
  }
  static func localURL(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else { throw failure("PDF_INVALID") }
    let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
    let home = URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path + "/"
    guard resolved.path.hasPrefix(home) else { throw failure("PDF_INVALID") }
    let values = try resolved.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
    guard values.isRegularFile == true, let size = values.fileSize, size > 0, size <= 30 * 1024 * 1024 else { throw failure("PDF_FILE_LIMIT") }
    return resolved
  }
  static func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
  static func fileDigest(_ url: URL) throws -> String {
    let file = try localURL(url.absoluteString)
    let handle = try FileHandle(forReadingFrom: file)
    defer { try? handle.close() }
    var hash = SHA256(), length = 0
    while let data = try handle.read(upToCount: 64 * 1024), !data.isEmpty {
      length += data.count
      guard length <= 30 * 1024 * 1024 else { throw failure("PDF_FILE_LIMIT") }
      hash.update(data: data)
    }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }
  static func directory(_ scope: String, create: Bool = false) throws -> URL {
    guard scope == "device" || (scope.utf8.count == 72 && scope.range(of: "^account-[a-f0-9]{64}$", options: .regularExpression) != nil) else { throw failure("PDF_LIBRARY_SCOPE") }
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: create).standardizedFileURL.resolvingSymlinksInPath()
    var directory = base.appendingPathComponent("pdf-originals", isDirectory: true)
    // Device originals keep their existing location. Account directories cannot
    // alias it or another account, including through an existing symbolic link.
    guard directory.resolvingSymlinksInPath().path == directory.path else { throw failure("PDF_LIBRARY_SCOPE") }
    if scope != "device" { directory.appendPathComponent(scope, isDirectory: true) }
    guard directory.resolvingSymlinksInPath().path == directory.path else { throw failure("PDF_LIBRARY_SCOPE") }
    if create {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      // Original books stay local: exclude this private directory from iCloud/device backups.
      var values = URLResourceValues(); values.isExcludedFromBackup = true
      try directory.setResourceValues(values)
    }
    return directory
  }
  static func location(_ bookID: String, scope: String = "device", create: Bool = false) throws -> URL {
    guard bookID.utf8.count <= 256, bookID.range(of: "^[a-fA-F0-9]{64}\\.pdf(?:kit|js)-", options: .regularExpression) != nil else { throw failure("PDF_ORIGINAL_ID") }
    let file = try directory(scope, create: create).appendingPathComponent(digest(Data(bookID.utf8)) + ".pdf")
    guard file.resolvingSymlinksInPath().path == file.path else { throw failure("PDF_LIBRARY_SCOPE") }
    return file
  }
  static func viewURL(_ uri: String, scope: String) throws -> URL {
    let file = try localURL(uri)
    let directory = try directory(scope)
    guard file.deletingLastPathComponent().path == directory.path,
      file.lastPathComponent.range(of: "^[a-f0-9]{64}\\.pdf$", options: .regularExpression) != nil else { throw failure("PDF_LIBRARY_SCOPE") }
    return file
  }
  static func info(_ url: URL, created: Bool = false) throws -> [String: Any] {
    let file = try localURL(url.absoluteString)
    return ["uri": file.absoluteString, "size": try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0, "created": created]
  }
  static func retain(_ uri: String, bookID: String, scope: String = "device") throws -> [String: Any] {
    let source = try localURL(uri)
    let destination = try location(bookID, scope: scope, create: true)
    let temporary = destination.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".tmp")
    defer { try? FileManager.default.removeItem(at: temporary) }
    try FileManager.default.copyItem(at: source, to: temporary)
    let fingerprint = digest(try Data(contentsOf: temporary, options: .mappedIfSafe))
    guard fingerprint == String(bookID.prefix(64)).lowercased() else { throw failure("PDF_ORIGINAL_MISMATCH") }
    guard PDFDocument(url: temporary) != nil else { throw failure("PDF_INVALID") }
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
    if FileManager.default.fileExists(atPath: destination.path) {
      // A readable PDF can still contain the wrong or truncated bytes. Keep a
      // valid association unchanged, but repair a damaged one with the verified
      // source in one replacement (never delete the old file before moving).
      if (try? fileDigest(destination)) != fingerprint {
        _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary, backupItemName: nil, options: .usingNewMetadataOnly)
      }
      // A repair is not a new association: import rollback must not delete it.
      return try info(destination)
    }
    try FileManager.default.moveItem(at: temporary, to: destination)
    return try info(destination, created: true)
  }
}

// Keep document links inside the reader; original-page viewing never launches remote resources.
private final class LocalPdfView: PDFView {
  override func perform(_ action: PDFAction) {
    if let link = action as? PDFActionGoTo, link.destination.page?.document === document {
      super.perform(action)
    } else if let named = action as? PDFActionNamed {
      switch named.name {
      case .nextPage, .previousPage, .firstPage, .lastPage, .goBack, .goForward, .zoomIn, .zoomOut: super.perform(action)
      default: break
      }
    }
  }
}

private final class PdfSearchJob {
  private let lock = NSLock()
  private var cancelled = false
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
  func check() throws {
    if isCancelled { throw PdfOriginals.failure("PDF_CANCELLED") }
  }
}

private struct PdfSearchHit {
  let page: Int
  let range: NSRange
}

private struct PdfSearchResult {
  let hits: [PdfSearchHit]
  let scannedPages: Int
  let totalPages: Int
  let limited: Bool
  let hasText: Bool
}

private enum PdfOriginalSearch {
  static let maxHits = 2000
  static func evidence(_ text: String, range: NSRange) -> [String: String]? {
    let value = text as NSString, count = value.length
    guard range.location != NSNotFound, range.location >= 0, range.length > 0,
      range.length <= 640, range.location <= count, range.length <= count - range.location else { return nil }
    func boundary(_ offset: Int) -> Bool {
      guard offset > 0, offset < count else { return true }
      return !(0xD800...0xDBFF).contains(value.character(at: offset - 1)) ||
        !(0xDC00...0xDFFF).contains(value.character(at: offset))
    }
    let end = NSMaxRange(range)
    // Never shorten a match or hand JS half a UTF-16 surrogate pair.
    guard boundary(range.location), boundary(end) else { return nil }
    var before = max(0, range.location - 80), after = min(count, end + 80)
    if !boundary(before) { before += 1 }
    if !boundary(after) { after -= 1 }
    return ["quote": value.substring(with: range),
      "before": value.substring(with: NSRange(location: before, length: range.location - before)),
      "after": value.substring(with: NSRange(location: end, length: after - end))]
  }
  static func query(_ value: String) -> String {
    value.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
  }
  static func pattern(_ query: String) throws -> NSRegularExpression {
    guard !query.isEmpty, query.utf16.count <= 160 else { throw PdfOriginals.failure("PDF_SEARCH_QUERY_LIMIT") }
    // Only whitespace is flexible; punctuation and all other user input are literal.
    let pattern = query.components(separatedBy: " ").map(NSRegularExpression.escapedPattern(for:)).joined(separator: "\\s+")
    return try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
  }
  static func scan(source: String, scope: String, password: String, pattern: NSRegularExpression,
    job: PdfSearchJob, progress: (Int, Int, Bool) -> Void) throws -> PdfSearchResult {
    try job.check()
    let url = try PdfOriginals.viewURL(source, scope: scope)
    guard let document = PDFDocument(url: url) else { throw PdfOriginals.failure("PDF_INVALID") }
    if document.isLocked && !document.unlock(withPassword: password) { throw PdfOriginals.failure("PDF_PASSWORD") }
    guard document.allowsCopying else { throw PdfOriginals.failure("PDF_COPY_RESTRICTED") }
    let total = document.pageCount
    guard total > 0, total <= 1000 else { throw PdfOriginals.failure("PDF_PAGE_LIMIT") }
    var hits: [PdfSearchHit] = [], characters = 0, hasText = false
    for index in 0..<total {
      try job.check()
      let limited = try autoreleasepool { () throws -> Bool in
        guard let page = document.page(at: index) else { throw PdfOriginals.failure("PDF_INVALID") }
        let text = page.string ?? ""
        let length = (text as NSString).length
        characters += length
        guard length <= 1024 * 1024, characters <= 20 * 1024 * 1024 else { throw PdfOriginals.failure("PDF_SEARCH_TEXT_LIMIT") }
        hasText = hasText || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        var start = 0
        while start < length {
          try job.check()
          guard let match = pattern.firstMatch(in: text, range: NSRange(location: start, length: length - start)) else { break }
          guard match.range.length > 0 else { break }
          // Probe one additional hit: exactly 2000 matches is not a limited result.
          if hits.count == maxHits { return true }
          hits.append(PdfSearchHit(page: index + 1, range: match.range))
          start = NSMaxRange(match.range)
        }
        return false
      }
      try job.check()
      if limited { return PdfSearchResult(hits: hits, scannedPages: index + 1, totalPages: total, limited: true, hasText: hasText) }
      if (index + 1) % 16 == 0 { progress(index + 1, total, hasText) }
    }
    return PdfSearchResult(hits: hits, scannedPages: total, totalPages: total, limited: false, hasText: hasText)
  }
}

final class ByPagePdfView: ExpoView {
  let onReady = EventDispatcher()
  let onPageChange = EventDispatcher()
  let onError = EventDispatcher()
  let onSearch = EventDispatcher()
  var uri = ""
  var libraryScope = "device"
  var password = ""
  var targetPage = 1
  var thumbnails = false
  var documentId = ""
  var navigationId = ""
  var searchQuery = ""
  var searchId = ""
  var searchIndex = -1
  private let pdf = LocalPdfView()
  private var thumbnailStrip: PDFThumbnailView?
  private struct ThumbnailAnchor {
    let page: PDFPage
    let generation: Int
    let revision: Int
    let documentId: String
    let navigationId: String
  }
  private var thumbnailResizeAnchor: ThumbnailAnchor?
  private var thumbnailResizeRevision = 0
  private var loadedURI = ""
  private var loadedScope = ""
  private var loadedPassword = ""
  private var loadedDocumentId = ""
  private var generation = 0
  private var suppressPageEvent = false
  private var navigationInFlight = false
  private var lastRequestedPage = 0
  private var lastNavigationId = ""
  private var readyPending = false
  private var lastEmittedPage = 0
  private var lastEmittedNavigationId = ""
  private let searchQueue = DispatchQueue(label: "bypage.pdf.original-search", qos: .userInitiated)
  private var searchJob: PdfSearchJob?
  private var loadedSearchId = ""
  private var loadedSearchQuery = ""
  private var completedSearchId = ""
  private var searchHits: [PdfSearchHit] = []
  private var searchPattern: NSRegularExpression?
  private var failedSearchNavigationId: String?
  private struct SelectedEvidence {
    let documentId: String
    let navigationId: String
    let searchId: String
    let index: Int
    let page: Int
    let text: [String: String]
  }
  private var selectedEvidence: SelectedEvidence?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    pdf.displayMode = .singlePageContinuous
    pdf.displayDirection = .vertical
    pdf.displaysPageBreaks = true
    pdf.autoScales = true
    pdf.backgroundColor = .secondarySystemBackground
    addSubview(pdf)
    NotificationCenter.default.addObserver(self, selector: #selector(pageChanged), name: .PDFViewPageChanged, object: pdf)
  }
  deinit { searchJob?.cancel(); NotificationCenter.default.removeObserver(self) }
  override func layoutSubviews() {
    super.layoutSubviews()
    updateThumbnails()
    let stripHeight = thumbnailStrip == nil ? 0 : min(120, max(0, bounds.height * 0.3))
    let pageFrame = CGRect(x: 0, y: 0, width: bounds.width, height: max(0, bounds.height - stripHeight))
    // PDFKit owns the scroll position during viewport changes. currentDestination is not
    // an idempotent resize anchor in continuous mode; replaying it here accumulates drift.
    if pdf.frame != pageFrame { pdf.frame = pageFrame }
    if let strip = thumbnailStrip {
      let stripFrame = CGRect(x: 0, y: pageFrame.maxY, width: bounds.width, height: stripHeight)
      if strip.frame != stripFrame { strip.frame = stripFrame }
      let size = CGSize(width: 66, height: max(1, min(88, stripHeight - 24)))
      if strip.thumbnailSize != size { strip.thumbnailSize = size }
    }
    navigate()
    if let anchor = thumbnailResizeAnchor {
      thumbnailResizeAnchor = nil
      // A strip toggle gets at most one page-level correction after layout settles.
      // Keyboard/layout animation frames never resample or replay destinations.
      DispatchQueue.main.async { [weak self] in
        guard let self, self.window != nil, self.generation == anchor.generation,
          self.thumbnailResizeRevision == anchor.revision, self.loadedDocumentId == anchor.documentId,
          self.documentId == anchor.documentId, self.navigationId == anchor.navigationId,
          self.lastNavigationId == anchor.navigationId, self.targetPage == self.lastRequestedPage,
          !self.readyPending, !self.navigationInFlight, anchor.page.document === self.pdf.document,
          self.pdf.currentPage !== anchor.page else { return }
        self.navigationInFlight = true
        let wasSuppressed = self.suppressPageEvent; self.suppressPageEvent = true
        self.pdf.go(to: anchor.page)
        self.suppressPageEvent = wasSuppressed; self.navigationInFlight = false
        self.pageChanged()
      }
    }
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      cancelSearch()
      removeThumbnails()
      generation += 1; pdf.document = nil; loadedURI = ""; loadedScope = ""; loadedPassword = ""; loadedDocumentId = ""
      lastRequestedPage = 0; lastNavigationId = ""; readyPending = false
      lastEmittedPage = 0; lastEmittedNavigationId = ""
    } else { update() }
  }
  func update() {
    guard window != nil, !uri.isEmpty else { return }
    if uri != loadedURI || libraryScope != loadedScope || password != loadedPassword || documentId != loadedDocumentId {
      cancelSearch()
      generation += 1
      let ticket = generation, source = uri, secret = password, scope = libraryScope
      let documentToken = documentId, navigationToken = navigationId
      loadedURI = source; loadedScope = scope; loadedPassword = secret; loadedDocumentId = documentToken
      lastRequestedPage = 0; lastNavigationId = ""; readyPending = false
      lastEmittedPage = 0; lastEmittedNavigationId = ""
      removeThumbnails()
      pdf.document = nil
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        let result = Result { () throws -> PDFDocument in
          let url = try PdfOriginals.viewURL(source, scope: scope)
          guard let document = PDFDocument(url: url) else { throw PdfOriginals.failure("PDF_INVALID") }
          if document.isLocked && !document.unlock(withPassword: secret) { throw PdfOriginals.failure("PDF_PASSWORD") }
          guard document.pageCount > 0, document.pageCount <= 1000 else { throw PdfOriginals.failure("PDF_PAGE_LIMIT") }
          return document
        }
        DispatchQueue.main.async { [weak self] in
          guard let self, self.generation == ticket, self.window != nil,
            self.documentId == documentToken, self.loadedDocumentId == documentToken,
            self.libraryScope == scope, self.loadedScope == scope else { return }
          switch result {
          case .success(let document):
            self.suppressPageEvent = true
            self.pdf.document = document
            self.pdf.autoScales = true
            self.readyPending = true
            self.updateThumbnails()
            self.setNeedsLayout()
            self.suppressPageEvent = false
            self.updateSearch()
            // navigate() waits for a real viewport and acknowledges PDFKit's actual currentPage.
            self.navigate()
          case .failure(let error):
            self.onError(["code": (error as NSError).domain == "ByPagePDF" ? error.localizedDescription : "PDF_INVALID",
              "documentId": documentToken, "navigationId": navigationToken])
          }
        }
      }
    } else {
      updateSearch()
      updateThumbnails()
      navigate()
    }
  }
  private func cancelSearch() {
    searchJob?.cancel(); searchJob = nil
    loadedSearchId = ""; loadedSearchQuery = ""; completedSearchId = ""
    searchHits = []; searchPattern = nil; failedSearchNavigationId = nil
    pdf.highlightedSelections = nil
    selectedEvidence = nil
  }
  private func currentSearch(_ job: PdfSearchJob, generation ticket: Int, document token: String,
    search id: String, query: String) -> Bool {
    window != nil && generation == ticket && loadedDocumentId == token && documentId == token &&
      loadedScope == libraryScope && loadedSearchId == id && searchId == id &&
      loadedSearchQuery == query && searchJob === job && !job.isCancelled
  }
  private func emitSearch(_ status: String, document: String, search: String,
    scanned: Int, total: Int, hits: [PdfSearchHit] = [], limited: Bool = false,
    hasText: Bool = false, code: String? = nil) {
    var payload: [String: Any] = ["documentId": document, "searchId": search, "status": status,
      "scannedPages": scanned, "totalPages": total,
      "matches": hits.map { ["page": $0.page] }, "limited": limited, "hasText": hasText]
    if let code { payload["code"] = code }
    onSearch(payload)
  }
  private func updateSearch() {
    guard window != nil, loadedDocumentId == documentId, let document = pdf.document else { return }
    // Reject an oversized bridge value before allocating a whitespace-token array.
    let query = searchQuery.utf16.count <= 640 ? PdfOriginalSearch.query(searchQuery) : searchQuery
    let id = searchId
    guard id != loadedSearchId || query != loadedSearchQuery else { return }
    cancelSearch()
    loadedSearchId = id; loadedSearchQuery = query
    let token = loadedDocumentId, total = document.pageCount
    guard !id.isEmpty else { return }
    guard !query.isEmpty else {
      completedSearchId = id
      emitSearch("complete", document: token, search: id, scanned: 0, total: total)
      return
    }
    let pattern: NSRegularExpression
    do { pattern = try PdfOriginalSearch.pattern(query) }
    catch {
      emitSearch("error", document: token, search: id, scanned: 0, total: total, code: "PDF_SEARCH_QUERY_LIMIT")
      return
    }
    let job = PdfSearchJob(), ticket = generation, source = loadedURI, scope = loadedScope, secret = loadedPassword
    searchJob = job
    emitSearch("searching", document: token, search: id, scanned: 0, total: total)
    // Never ask the displayed PDFDocument to find the whole book on the main thread.
    // Each query owns a separate document; only page numbers and UTF-16 ranges survive.
    searchQueue.async { [weak self] in
      let result = Result {
        try PdfOriginalSearch.scan(source: source, scope: scope, password: secret, pattern: pattern, job: job) { scanned, count, hasText in
          DispatchQueue.main.async { [weak self] in
            guard let self, self.currentSearch(job, generation: ticket, document: token, search: id, query: query) else { return }
            self.emitSearch("searching", document: token, search: id, scanned: scanned, total: count, hasText: hasText)
          }
        }
      }
      DispatchQueue.main.async { [weak self] in
        guard let self, self.currentSearch(job, generation: ticket, document: token, search: id, query: query) else { return }
        switch result {
        case .success(let value):
          self.searchHits = value.hits; self.searchPattern = pattern; self.completedSearchId = id
          self.emitSearch("complete", document: token, search: id, scanned: value.scannedPages,
            total: value.totalPages, hits: value.hits, limited: value.limited, hasText: value.hasText)
          self.navigate()
        case .failure(let error):
          self.emitSearch("error", document: token, search: id, scanned: 0, total: total,
            code: (error as NSError).domain == "ByPagePDF" ? error.localizedDescription : "PDF_INVALID")
        }
      }
    }
  }
  private func removeThumbnails() {
    guard let strip = thumbnailStrip else { return }
    captureThumbnailPage()
    strip.pdfView = nil
    strip.removeFromSuperview()
    thumbnailStrip = nil
    setNeedsLayout()
  }
  private func captureThumbnailPage() {
    thumbnailResizeRevision += 1
    thumbnailResizeAnchor = nil
    if window != nil, !readyPending, lastRequestedPage > 0,
      targetPage == lastRequestedPage, navigationId == lastNavigationId, let page = pdf.currentPage {
      thumbnailResizeAnchor = ThumbnailAnchor(page: page, generation: generation,
        revision: thumbnailResizeRevision, documentId: loadedDocumentId, navigationId: navigationId)
    }
  }
  private func updateThumbnails() {
    guard thumbnails, window != nil, pdf.document != nil else { removeThumbnails(); return }
    guard thumbnailStrip == nil else { return }
    captureThumbnailPage()
    // PDFKit owns scrolling, thumbnail rendering and taps; no all-pages image array is created.
    let strip = PDFThumbnailView()
    strip.layoutMode = .horizontal
    strip.thumbnailSize = CGSize(width: 66, height: 88)
    strip.contentInset = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
    strip.backgroundColor = .secondarySystemBackground
    strip.clipsToBounds = true
    strip.pdfView = pdf
    thumbnailStrip = strip
    addSubview(strip)
    setNeedsLayout()
  }
  private func navigate() {
    guard !navigationInFlight, window != nil, pdf.bounds.width > 0, pdf.bounds.height > 0,
      loadedDocumentId == documentId, let document = pdf.document else { return }
    let wanted = min(max(1, targetPage), document.pageCount)
    guard readyPending || wanted != lastRequestedPage || navigationId != lastNavigationId,
      let page = document.page(at: wanted - 1) else { return }
    let selection: PDFSelection?
    var evidence: [String: String]?
    if searchIndex >= 0 {
      // An in-progress or superseded search cannot authorize a selection command.
      guard !searchId.isEmpty, completedSearchId == searchId, loadedSearchId == searchId else { return }
      guard searchIndex < searchHits.count, let pattern = searchPattern else {
        rejectSearchNavigation(); return
      }
      let hit = searchHits[searchIndex]
      let text = page.string ?? ""
      guard hit.page == wanted, NSMaxRange(hit.range) <= (text as NSString).length,
        let match = pattern.firstMatch(in: text, options: [.anchored], range: hit.range),
        match.range == hit.range, let found = page.selection(for: hit.range) else {
        rejectSearchNavigation(); return
      }
      selection = found
      evidence = PdfOriginalSearch.evidence(text, range: hit.range)
    } else { selection = nil }
    navigationInFlight = true
    defer { navigationInFlight = false }
    let ticket = generation, documentToken = loadedDocumentId, navigationToken = navigationId
    let searchToken = searchId, selectedIndex = searchIndex
    selectedEvidence = nil
    let wasSuppressed = suppressPageEvent; suppressPageEvent = true
    pdf.layoutIfNeeded()
    if let selection {
      selection.color = UIColor.systemYellow.withAlphaComponent(0.45)
      pdf.highlightedSelections = [selection]
      pdf.go(to: page)
      pdf.layoutIfNeeded()
      // go(to:selection) aligns the first character at the viewport's top. At
      // page ends that can put nearly all of the following page on screen.
      // Ask PDFKit to reveal a viewport-sized region around the first matched
      // line instead. Its conversions account for page rotation, crop and zoom.
      let line = selection.selectionsByLine().first ?? selection
      let hit = pdf.convert(line.bounds(for: page), from: page)
      if hit.minX.isFinite, hit.minY.isFinite, hit.width.isFinite, hit.height.isFinite,
        hit.width > 0, hit.height > 0 {
        let vertical = max(0, (pdf.bounds.height - hit.height) / 2 - 1)
        let horizontal = min(24, max(0, (pdf.bounds.width - hit.width) / 2 - 1))
        let region = pdf.convert(hit.insetBy(dx: -horizontal, dy: -vertical), to: page)
        pdf.go(to: region, on: page)
      } else { pdf.go(to: selection) }
    } else {
      pdf.highlightedSelections = nil
      pdf.go(to: page)
    }
    pdf.layoutIfNeeded()
    suppressPageEvent = wasSuppressed
    guard generation == ticket, documentId == documentToken, navigationId == navigationToken,
      searchId == searchToken, searchIndex == selectedIndex,
      pdf.document === document, let actual = pdf.currentPage else { return }
    let number = document.index(for: actual) + 1
    // A command isn't complete merely because the requested number was accepted as a prop.
    guard number > 0, number <= document.pageCount, selection != nil || number == wanted else { return }
    // PDFKit defines currentPage using the viewport's midpoint. A match near a
    // page boundary can be visible while that midpoint is on its neighbour.
    // Preserve the command's page, acknowledge the actual page, and never replay
    // the selection merely because PDFKit reports that neighbouring page.
    lastRequestedPage = wanted; lastNavigationId = navigationToken
    if number == wanted, selection != nil, let evidence {
      selectedEvidence = SelectedEvidence(documentId: documentToken, navigationId: navigationToken,
        searchId: searchToken, index: selectedIndex, page: number, text: evidence)
    }
    if readyPending {
      readyPending = false
      var payload = pagePayload(number, documentId: documentToken, navigationId: navigationToken)
      payload["totalPages"] = document.pageCount
      onReady(payload)
    }
    emitPage(number, documentId: documentToken, navigationId: navigationToken)
  }
  private func rejectSearchNavigation() {
    selectedEvidence = nil
    guard failedSearchNavigationId != navigationId else { return }
    failedSearchNavigationId = navigationId
    onError(["code": "PDF_SEARCH_RESULT_INVALID", "documentId": loadedDocumentId, "navigationId": navigationId])
  }
  private func emitPage(_ number: Int, documentId: String, navigationId: String) {
    let payload = pagePayload(number, documentId: documentId, navigationId: navigationId)
    guard number != lastEmittedPage || navigationId != lastEmittedNavigationId else { return }
    lastEmittedPage = number; lastEmittedNavigationId = navigationId
    onPageChange(payload)
  }
  private func pagePayload(_ number: Int, documentId: String, navigationId: String) -> [String: Any] {
    var payload: [String: Any] = ["page": number, "documentId": documentId,
      "navigationId": navigationId, "searchId": searchId, "searchIndex": searchIndex]
    if let selected = selectedEvidence {
      if selected.documentId == documentId, selected.navigationId == navigationId,
        selected.searchId == searchId, selected.index == searchIndex,
        completedSearchId == searchId, selected.page == number {
        payload["evidence"] = selected.text
      } else {
        // Once the reader leaves the selected page, scrolling back cannot revive
        // an old hit. Only another explicit match command can establish evidence.
        selectedEvidence = nil
      }
    }
    return payload
  }
  @objc private func pageChanged() {
    guard !suppressPageEvent, window != nil, loadedDocumentId == documentId,
      let document = pdf.document, let page = pdf.currentPage else { return }
    if readyPending || navigationId != lastNavigationId || targetPage != lastRequestedPage {
      // Do not let an old PDFKit notification turn an unacknowledged command into a user scroll.
      navigate(); return
    }
    let number = document.index(for: page) + 1
    guard number > 0, number <= document.pageCount else { return }
    // With command IDs, these fields remain the last explicit command. React may send
    // only a new ID when requesting that same number again after a PDFKit user scroll.
    if navigationId.isEmpty { targetPage = number; lastRequestedPage = number }
    emitPage(number, documentId: loadedDocumentId, navigationId: lastNavigationId)
  }
}

public final class ByPagePdfModule: Module {
  private let lock = NSLock()
  private var cancelled = Set<String>()
  private var finishedJobs: [String] = []
  private var activeVision: (job: String, request: VNRequest)?
  private let queue = DispatchQueue(label: "bypage.pdf.extract", qos: .userInitiated)
  private let originalQueue = DispatchQueue(label: "bypage.pdf.original", qos: .userInitiated)

  // A single live import owns this cache. Closing or explicitly changing the range
  // releases it; no unfinished page or password is persisted to disk.
  private final class ExtractionSession {
    let id: String
    let uri: String
    let password: String?
    let from: Int
    let to: Int
    let ocr: Bool
    let document: PDFDocument
    var pages: [[String: Any]] = []
    var length = 0
    init(id: String, uri: String, password: String?, from: Int, to: Int, ocr: Bool, document: PDFDocument) {
      self.id = id; self.uri = uri; self.password = password
      self.from = from; self.to = to; self.ocr = ocr; self.document = document
    }
    func matches(uri: String, password: String?, from: Int, to: Int, ocr: Bool) -> Bool {
      self.uri == uri && self.password == password && self.from == from && self.to == to && self.ocr == ocr
    }
  }
  private var extractionSession: ExtractionSession?

  private func failure(_ code: String) -> NSError {
    NSError(domain: "ByPagePDF", code: 1, userInfo: [NSLocalizedDescriptionKey: code])
  }
  private func check(_ job: String) throws {
    lock.lock(); let stopped = cancelled.contains(job); lock.unlock()
    if stopped { throw failure("PDF_CANCELLED") }
  }
  private func cancel(_ job: String) {
    guard UUID(uuidString: job) != nil else { return }
    lock.lock()
    // A cancellation can reach native after its completed promise was enqueued.
    // Do not retain those late IDs forever or cancel a subsequent operation.
    if !finishedJobs.contains(job) { cancelled.insert(job) }
    let request = activeVision?.job == job ? activeVision?.request : nil
    lock.unlock()
    request?.cancel()
  }
  private func finish(_ job: String) {
    lock.lock()
    cancelled.remove(job)
    finishedJobs.append(job)
    if finishedJobs.count > 64 { finishedJobs.removeFirst(finishedJobs.count - 64) }
    if activeVision?.job == job { activeVision = nil }
    lock.unlock()
  }
  private func document(_ uri: String, _ password: String?) throws -> PDFDocument {
    guard let url = URL(string: uri), url.isFileURL,
          url.standardizedFileURL.path.hasPrefix(NSHomeDirectory() + "/") else { throw failure("PDF_INVALID") }
    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size > 0, size <= 30 * 1024 * 1024 else { throw failure("PDF_FILE_LIMIT") }
    guard let doc = PDFDocument(url: url) else { throw failure("PDF_INVALID") }
    if doc.isLocked {
      guard let password, doc.unlock(withPassword: password) else { throw failure("PDF_PASSWORD") }
    }
    guard doc.allowsCopying else { throw failure("PDF_COPY_RESTRICTED") }
    guard doc.pageCount > 0, doc.pageCount <= 1000 else { throw failure("PDF_PAGE_LIMIT") }
    return doc
  }
  private func metadata(_ doc: PDFDocument) -> [String: Any] {
    let attrs = doc.documentAttributes ?? [:]
    return ["totalPages": doc.pageCount, "title": String((attrs[PDFDocumentAttribute.titleAttribute] as? String ?? "").prefix(2000)), "author": String((attrs[PDFDocumentAttribute.authorAttribute] as? String ?? "").prefix(2000))]
  }
  private struct ExtractedLine {
    var text: String
    var bounds: CGRect
    var listItem = false
  }
  private func repairDetachedMarkers(_ lines: [ExtractedLine]) -> [ExtractedLine] {
    // PDFKit can return a column of list numbers before their matching titles.
    // Join only an unambiguous, nearby item on the same line; retain the body's
    // original order instead of sorting the page (which could interleave columns).
    let markers = lines.map { $0.text.range(of: "^[0-9]{1,3}[.)]$", options: .regularExpression) != nil }
    var claims: [Int: [Int]] = [:]
    for marker in lines.indices where markers[marker] {
      let bounds = lines[marker].bounds
      let matches = lines.indices.filter { index in
        guard index != marker, !markers[index], !lines[index].text.isEmpty else { return false }
        let other = lines[index].bounds
        let gap = other.minX - bounds.maxX
        return abs(other.midY - bounds.midY) <= min(bounds.height, other.height) * 0.25 && gap >= 0 && gap <= max(bounds.height, other.height) * 2
      }
      if matches.count == 1 { claims[matches[0], default: []].append(marker) }
    }
    var updated = lines
    var consumed = Set<Int>()
    for (body, candidates) in claims where candidates.count == 1 {
      let marker = candidates[0]
      updated[body].text = lines[marker].text + " " + lines[body].text
      updated[body].bounds = lines[marker].bounds.union(lines[body].bounds)
      updated[body].listItem = true
      consumed.insert(marker)
    }
    return updated.enumerated().filter { !consumed.contains($0.offset) }.map(\.element)
  }
  private func textBlocks(_ page: PDFPage) -> [[String: String]] {
    let lines = repairDetachedMarkers((page.selection(for: page.bounds(for: .mediaBox))?.selectionsByLine() ?? []).map {
      ExtractedLine(text: $0.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "", bounds: $0.bounds(for: page))
    })
    var result: [[String: String]] = [], paragraph = "", previous: CGRect?
    func commit() { if !paragraph.isEmpty { result.append(["text": paragraph]); paragraph = "" } }
    for line in lines {
      let text = line.text
      if text.isEmpty { continue }
      let bounds = line.bounds
      if line.listItem { commit() }
      if let old = previous {
        let height = max(old.height, bounds.height, 1)
        let gap = old.minY - bounds.maxY
        if gap > height * 0.65 || bounds.minY > old.maxY || abs(bounds.height - old.height) > 2 || abs(bounds.minX - old.minX) > height * 3 { commit() }
      }
      if !paragraph.isEmpty {
        let cjk = "[\\p{Han}\\p{Hiragana}\\p{Katakana}]"
        let joinsCjk = String(paragraph.suffix(1)).range(of: cjk, options: .regularExpression) != nil && String(text.prefix(1)).range(of: cjk, options: .regularExpression) != nil
        if !joinsCjk { paragraph += " " }
      }
      paragraph += text
      previous = bounds
    }
    commit()
    if result.isEmpty, let text = page.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty { result = [["text": text]] }
    return result
  }
  private func recognize(_ page: PDFPage, job: String) throws -> String {
    try check(job)
    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else { return "" }
    let scale = min(2.5, 2200 / max(bounds.width, bounds.height))
    let width = max(1, Int(bounds.width * scale)), height = max(1, Int(bounds.height * scale))
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw failure("PDF_OCR_FAILED") }
    context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.scaleBy(x: scale, y: scale)
    context.translateBy(x: -bounds.origin.x, y: -bounds.origin.y)
    page.draw(with: .mediaBox, to: context)
    try check(job)
    guard let image = context.makeImage() else { throw failure("PDF_OCR_FAILED") }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    lock.lock()
    let stopped = cancelled.contains(job)
    if !stopped { activeVision = (job, request) }
    lock.unlock()
    if stopped { throw failure("PDF_CANCELLED") }
    defer {
      lock.lock()
      if activeVision?.request === request { activeVision = nil }
      lock.unlock()
    }
    try VNImageRequestHandler(cgImage: image).perform([request])
    try check(job)
    let observations = (request.results ?? []).sorted { a, b in
      if abs(a.boundingBox.midY - b.boundingBox.midY) > 0.012 { return a.boundingBox.midY > b.boundingBox.midY }
      return a.boundingBox.minX < b.boundingBox.minX
    }
    return observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  }
  private func extractPage(_ doc: PDFDocument, number: Int, ocr: Bool, job: String) throws -> (output: [String: Any], length: Int) {
    try check(job)
    guard let page = doc.page(at: number - 1) else { throw failure("PDF_INVALID") }
    var blocks = textBlocks(page)
    var method = "text"
    try check(job)
    if blocks.isEmpty && ocr {
      let text = try recognize(page, job: job)
      blocks = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { ["text": $0] }
      method = "ocr"
    }
    return (["pageNumber": number, "blocks": blocks, "method": method], blocks.reduce(0) { $0 + ($1["text"]?.utf16.count ?? 0) })
  }
  private func extractionEnvelope(_ session: ExtractionSession, status: String, errorCode: String? = nil) -> [String: Any] {
    var result: [String: Any] = ["status": status, "completed": session.pages.count, "total": session.to - session.from + 1]
    if session.pages.count < session.to - session.from + 1 { result["sourcePage"] = session.from + session.pages.count }
    if let errorCode { result["errorCode"] = errorCode }
    if status == "complete" {
      var document = metadata(session.document); document["pages"] = session.pages
      result["document"] = document
    }
    return result
  }
  public func definition() -> ModuleDefinition {
    Name("ByPagePdf")
    Events("onProgress")
    Constant("originalViewVersion") { 1 }
    Constant("thumbnailsVersion") { 1 }
    Constant("navigationVersion") { 1 }
    Constant("searchVersion") { 1 }
    Constant("searchEvidenceVersion") { 1 }
    Constant("scopedOriginalVersion") { 1 }
    Constant("resumableExtractionVersion") { 1 }
    AsyncFunction("retainOriginal") { (bookID: String, uri: String) -> [String: Any] in
      try PdfOriginals.retain(uri, bookID: bookID)
    }.runOnQueue(originalQueue)
    AsyncFunction("getOriginal") { (bookID: String) -> [String: Any]? in
      let url = try PdfOriginals.location(bookID)
      guard FileManager.default.fileExists(atPath: url.path) else { return nil }
      return try PdfOriginals.info(url)
    }.runOnQueue(originalQueue)
    AsyncFunction("removeOriginal") { (bookID: String) in
      let url = try PdfOriginals.location(bookID)
      if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }.runOnQueue(originalQueue)
    AsyncFunction("retainOriginalInScope") { (scope: String, bookID: String, uri: String) -> [String: Any] in
      try PdfOriginals.retain(uri, bookID: bookID, scope: scope)
    }.runOnQueue(originalQueue)
    AsyncFunction("getOriginalInScope") { (scope: String, bookID: String) -> [String: Any]? in
      let url = try PdfOriginals.location(bookID, scope: scope)
      guard FileManager.default.fileExists(atPath: url.path) else { return nil }
      return try PdfOriginals.info(url)
    }.runOnQueue(originalQueue)
    AsyncFunction("removeAccountOriginals") { (scope: String) in
      guard scope != "device" else { throw PdfOriginals.failure("PDF_LIBRARY_SCOPE") }
      let directory = try PdfOriginals.directory(scope)
      if FileManager.default.fileExists(atPath: directory.path) {
        try FileManager.default.removeItem(at: directory)
      }
    }

    AsyncFunction("removeOriginalInScope") { (scope: String, bookID: String) in
      let url = try PdfOriginals.location(bookID, scope: scope)
      if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }.runOnQueue(originalQueue)
    View(ByPagePdfView.self) {
      Events("onReady", "onPageChange", "onError", "onSearch")
      Prop("uri") { (view: ByPagePdfView, value: String) in view.uri = value }
      Prop("libraryScope") { (view: ByPagePdfView, value: String) in view.libraryScope = value }
      Prop("password") { (view: ByPagePdfView, value: String) in view.password = value }
      Prop("page") { (view: ByPagePdfView, value: Int) in view.targetPage = max(1, value) }
      Prop("thumbnails") { (view: ByPagePdfView, value: Bool) in view.thumbnails = value }
      Prop("documentId") { (view: ByPagePdfView, value: String) in view.documentId = String(value.prefix(128)) }
      Prop("navigationId") { (view: ByPagePdfView, value: String) in view.navigationId = String(value.prefix(128)) }
      Prop("searchQuery") { (view: ByPagePdfView, value: String) in view.searchQuery = value }
      Prop("searchId") { (view: ByPagePdfView, value: String) in view.searchId = String(value.prefix(128)) }
      Prop("searchIndex") { (view: ByPagePdfView, value: Int) in view.searchIndex = value }
      OnViewDidUpdateProps { (view: ByPagePdfView) in view.update() }
    }
    Function("cancel") { (job: String) in
      self.cancel(job)
    }
    AsyncFunction("inspect") { (uri: String, password: String?) -> [String: Any] in
      self.metadata(try self.document(uri, password))
    }.runOnQueue(originalQueue)
    AsyncFunction("extractResumable") { (uri: String, password: String?, from: Int, to: Int, ocr: Bool, sessionId: String, job: String) -> [String: Any] in
      guard UUID(uuidString: sessionId) != nil, UUID(uuidString: job) != nil else { throw self.failure("PDF_SESSION_INVALID") }
      defer { self.finish(job) }
      guard from >= 1, to >= from, to <= 1000 else { throw self.failure("PDF_PAGE_RANGE") }
      let session: ExtractionSession
      if let existing = self.extractionSession {
        guard existing.id == sessionId else { throw self.failure("PDF_SESSION_LIMIT") }
        guard existing.matches(uri: uri, password: password, from: from, to: to, ocr: ocr) else { throw self.failure("PDF_SESSION_INVALID") }
        session = existing
      } else {
        do { try self.check(job) } catch {
          return ["status": "paused", "completed": 0, "total": to - from + 1, "sourcePage": from]
        }
        let doc = try self.document(uri, password)
        guard to <= doc.pageCount else { throw self.failure("PDF_PAGE_RANGE") }
        session = ExtractionSession(id: sessionId, uri: uri, password: password, from: from, to: to, ocr: ocr, document: doc)
        self.extractionSession = session
      }
      self.sendEvent("onProgress", ["job": job, "page": session.pages.count, "total": to - from + 1])
      while session.pages.count < to - from + 1 {
        let number = from + session.pages.count
        do {
          let page = try autoreleasepool { try self.extractPage(session.document, number: number, ocr: ocr, job: job) }
          // Commit an entire successful page only. Cancel and commit share a lock,
          // so a completed OCR callback cannot append after pause was accepted.
          self.lock.lock()
          let stopped = self.cancelled.contains(job)
          let exceedsBudget = page.length > 20 * 1024 * 1024 - session.length
          if !stopped && !exceedsBudget { session.pages.append(page.output); session.length += page.length }
          self.lock.unlock()
          if stopped { return self.extractionEnvelope(session, status: "paused") }
          if exceedsBudget { return self.extractionEnvelope(session, status: "failed", errorCode: "PDF_TEXT_LIMIT") }
          self.sendEvent("onProgress", ["job": job, "page": session.pages.count, "total": to - from + 1])
        } catch {
          self.lock.lock(); let stopped = self.cancelled.contains(job); self.lock.unlock()
          return self.extractionEnvelope(session, status: stopped ? "paused" : "failed", errorCode: stopped ? nil : "PDF_PAGE_FAILED")
        }
      }
      self.lock.lock(); let stopped = self.cancelled.contains(job); self.lock.unlock()
      return self.extractionEnvelope(session, status: stopped ? "paused" : "complete")
    }.runOnQueue(queue)
    AsyncFunction("closeExtraction") { (sessionId: String) in
      // The serial queue drains any running page first. A late close never owns a
      // different import and must not release its document or successful pages.
      if self.extractionSession?.id == sessionId { self.extractionSession = nil }
    }.runOnQueue(queue)
    AsyncFunction("extract") { (uri: String, password: String?, from: Int, to: Int, ocr: Bool, job: String) -> [String: Any] in
      defer { self.finish(job) }
      let doc = try self.document(uri, password)
      guard from >= 1, to >= from, to <= doc.pageCount else { throw self.failure("PDF_PAGE_RANGE") }
      var pages: [[String: Any]] = [], length = 0
      for number in from...to {
        let page = try autoreleasepool { try self.extractPage(doc, number: number, ocr: ocr, job: job) }
        length += page.length
        guard length <= 20 * 1024 * 1024 else { throw self.failure("PDF_TEXT_LIMIT") }
        try self.check(job)
        pages.append(page.output)
        self.sendEvent("onProgress", ["job": job, "page": number - from + 1, "total": to - from + 1])
      }
      var result = self.metadata(doc); result["pages"] = pages
      return result
    }.runOnQueue(queue)
  }
}
