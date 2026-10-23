import ExpoModulesCore
import UIKit
import ImageIO

private struct Mark: Decodable { let start: Int; let end: Int }
private struct ReferenceMark: Decodable { let id: String; let start: Int; let end: Int; let label: String }
private struct Illustration: Decodable {
  let placementId: String
  let uri: String
  let displayWidth: Double
  let label: String
  let hint: String
  let errorLabel: String
}
private struct Fragment: Decodable {
  let image: Illustration?
  let text: String
  let paragraph: String?
  let source: String
  let start: Int
  let end: Int
  let height: Double
  let gap: Double
  let fontSize: Double
  let lineHeight: Double
  let fontFamily: String?
  let bold: Bool
  let italic: Bool
  let color: String
  let highlights: [Mark]
  let links: [ReferenceMark]?
}
private struct Page: Decodable {
  let index: Int
  let background: String
  let highlight: String
  let horizontal: Double
  let rtl: Bool
  let referenceColor: String?
  let fragments: [Fragment]
}
/** Only linked fragments use TextKit. Drawing and hit-testing share this exact layout. */
private final class ReadingReferenceLabel: UILabel {
  private let storage = NSTextStorage()
  private let manager = NSLayoutManager()
  private let container = NSTextContainer(size: .zero)
  private var layoutSize = CGSize.zero
  private var origin = CGPoint.zero
  private var marks: [ReferenceMark] = []
  override init(frame: CGRect) {
    super.init(frame: frame)
    storage.addLayoutManager(manager); manager.addTextContainer(container)
    container.lineFragmentPadding = 0; container.maximumNumberOfLines = 0; container.lineBreakMode = .byWordWrapping
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
  func configure(_ text: NSAttributedString, marks: [ReferenceMark]) {
    attributedText = text; storage.setAttributedString(text); self.marks = marks
    layoutSize = .zero; setNeedsDisplay()
  }
  private func prepare() {
    guard bounds.width > 0, bounds.height > 0 else { return }
    if layoutSize != bounds.size {
      container.size = bounds.size; layoutSize = bounds.size
      manager.ensureLayout(for: container)
      let used = manager.usedRect(for: container)
      origin = CGPoint(x: 0, y: max(0, (bounds.height - used.height) / 2 - used.minY))
    }
  }
  override func drawText(in rect: CGRect) {
    prepare()
    let range = manager.glyphRange(for: container)
    guard let context = UIGraphicsGetCurrentContext() else { return }
    context.saveGState(); context.clip(to: bounds)
    manager.drawBackground(forGlyphRange: range, at: origin)
    manager.drawGlyphs(forGlyphRange: range, at: origin)
    context.restoreGState()
  }
  func reference(at point: CGPoint) -> ReferenceMark? {
    prepare()
    guard bounds.contains(point), manager.numberOfGlyphs > 0 else { return nil }
    let local = CGPoint(x: point.x - origin.x, y: point.y - origin.y)
    guard manager.usedRect(for: container).contains(local) else { return nil }
    let glyph = manager.glyphIndex(for: local, in: container, fractionOfDistanceThroughGlyph: nil)
    guard glyph < manager.numberOfGlyphs,
      manager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container).contains(local)
    else { return nil }
    let character = manager.characterIndexForGlyph(at: glyph)
    return marks.first { $0.start <= character && character < $0.end }
  }
}
private final class ReadingImageControl: UIControl {
  private static let cache: NSCache<NSString, UIImage> = {
    let cache = NSCache<NSString, UIImage>(); cache.totalCostLimit = 32 * 1024 * 1024; return cache
  }()
  private static let queue: OperationQueue = {
    let queue = OperationQueue(); queue.maxConcurrentOperationCount = 2; queue.qualityOfService = .userInitiated; return queue
  }()
  private let imageView = UIImageView()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let failure = UILabel()
  init(_ image: Illustration, pixels: Int, failed: @escaping () -> Void) {
    super.init(frame: .zero)
    backgroundColor = .white
    isAccessibilityElement = true; accessibilityLabel = image.label; accessibilityHint = image.hint; accessibilityTraits = [.image, .button]
    imageView.contentMode = .scaleAspectFit; addSubview(imageView)
    spinner.color = .darkGray; spinner.startAnimating(); addSubview(spinner)
    failure.numberOfLines = 0; failure.textAlignment = .center; failure.textColor = .darkGray; failure.font = .systemFont(ofSize: 14); failure.text = image.errorLabel; failure.isHidden = true; addSubview(failure)
    let size = max(1, min(8192, pixels))
    let key = "\(image.uri):\(size)" as NSString
    if let cached = Self.cache.object(forKey: key) { imageView.image = cached; spinner.stopAnimating(); return }
    Self.queue.addOperation { [weak self] in
      var decoded: UIImage?
      let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("bypage-book-images", isDirectory: true).standardizedFileURL.path
      if let url = URL(string: image.uri), url.isFileURL, let directory, url.standardizedFileURL.path.hasPrefix(directory + "/"),
         let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
         let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
         let width = properties[kCGImagePropertyPixelWidth] as? NSNumber, let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
         width.intValue > 0, height.intValue > 0, width.intValue <= 8192, height.intValue <= 8192, width.intValue * height.intValue <= 16000000,
         let bitmap = CGImageSourceCreateThumbnailAtIndex(source, 0, [
           kCGImageSourceCreateThumbnailFromImageAlways: true,
           kCGImageSourceCreateThumbnailWithTransform: true,
           kCGImageSourceThumbnailMaxPixelSize: size,
           kCGImageSourceShouldCacheImmediately: true,
         ] as CFDictionary) {
        let result = UIImage(cgImage: bitmap); decoded = result
        Self.cache.setObject(result, forKey: key, cost: bitmap.bytesPerRow * bitmap.height)
      }
      let result = decoded
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.imageView.image = result; self.spinner.stopAnimating(); self.failure.isHidden = result != nil
        if result == nil { self.accessibilityLabel = image.label + ". " + image.errorLabel; failed() }
      }
    }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
  override func layoutSubviews() {
    super.layoutSubviews(); imageView.frame = bounds; spinner.center = CGPoint(x: bounds.midX, y: bounds.midY); failure.frame = bounds.insetBy(dx: 12, dy: 8)
  }
  override func accessibilityActivate() -> Bool { sendActions(for: .touchUpInside); return true }
}
private func color(_ value: String) -> UIColor {
  let raw = value.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
  guard raw.count == 6, let number = UInt(raw, radix: 16) else { return .label }
  return UIColor(red: CGFloat((number >> 16) & 255) / 255, green: CGFloat((number >> 8) & 255) / 255, blue: CGFloat(number & 255) / 255, alpha: 1)
}
private final class ReadingPageController: UIViewController {
  let index: Int
  var page: Page?
  var select: ((Fragment) -> Void)?
  var openImage: ((String) -> Void)?
  var imageError: ((String) -> Void)?
  var openReference: ((Fragment, ReferenceMark) -> Void)?
  private var contentViews: [UIView] = []
  init(index: Int, page: Page?) { self.index = index; self.page = page; super.init(nibName: nil, bundle: nil) }
  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
  override func viewDidLoad() { super.viewDidLoad(); render() }
  func update(_ page: Page?) { self.page = page; if isViewLoaded { render() } }
  func render() {
    contentViews.forEach { $0.removeFromSuperview() }; contentViews = []
    view.backgroundColor = page.map { color($0.background) } ?? .systemBackground
    guard let page else { return }
    for (index, fragment) in page.fragments.enumerated() {
      if let image = fragment.image {
        let displayWidth = max(1, image.displayWidth)
        let control = ReadingImageControl(image, pixels: Int(ceil(max(displayWidth, fragment.height) * (view.window?.screen.scale ?? 3)))) { [weak self] in self?.imageError?(image.placementId) }
        control.addAction(UIAction { [weak self] _ in self?.openImage?(image.placementId) }, for: .touchUpInside)
        contentViews.append(control); view.addSubview(control); continue
      }
      let links = fragment.source == "original" ? (fragment.links ?? []).filter { $0.start >= 0 && $0.end > $0.start && $0.end <= (fragment.text as NSString).length } : []
      let label: UILabel = links.isEmpty ? UILabel() : ReadingReferenceLabel(frame: .zero)
      label.numberOfLines = 0
      label.isUserInteractionEnabled = true
      label.tag = index
      label.accessibilityLabel = fragment.text
      label.accessibilityTraits = .staticText
      var font = fragment.fontFamily.flatMap { UIFont(name: $0, size: fragment.fontSize) } ?? UIFont.systemFont(ofSize: fragment.fontSize, weight: fragment.bold ? .semibold : .regular)
      var traits = font.fontDescriptor.symbolicTraits
      if fragment.bold { traits.insert(.traitBold) }
      if fragment.italic { traits.insert(.traitItalic) }
      if let descriptor = font.fontDescriptor.withSymbolicTraits(traits) { font = UIFont(descriptor: descriptor, size: fragment.fontSize) }
      let paragraph = NSMutableParagraphStyle()
      paragraph.minimumLineHeight = fragment.lineHeight
      paragraph.maximumLineHeight = fragment.lineHeight
      paragraph.alignment = page.rtl && fragment.source == "original" ? .right : .natural
      let text = NSMutableAttributedString(string: fragment.text, attributes: [
        .font: font, .foregroundColor: color(fragment.color), .paragraphStyle: paragraph,
        .baselineOffset: (fragment.lineHeight - font.lineHeight) / 2
      ])
      for mark in fragment.highlights {
        let from = max(0, mark.start), to = min(text.length, mark.end)
        if to > from { text.addAttribute(.backgroundColor, value: color(page.highlight), range: NSRange(location: from, length: to - from)) }
      }
      for link in links {
        text.addAttributes([.foregroundColor: page.referenceColor.map { color($0) } ?? UIColor.link, .underlineStyle: NSUnderlineStyle.single.rawValue], range: NSRange(location: link.start, length: link.end - link.start))
      }
      if let linked = label as? ReadingReferenceLabel { linked.configure(text, marks: links) }
      else { label.attributedText = text }
      if fragment.paragraph != nil {
        label.addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(longPress(_:))))
        label.accessibilityCustomActions = [UIAccessibilityCustomAction(name: "Annotate / 写笔记", actionHandler: { [weak self] _ in self?.select?(fragment); return true })]
        label.accessibilityCustomActions?.append(contentsOf: links.map { link in UIAccessibilityCustomAction(name: link.label, actionHandler: { [weak self] _ in self?.openReference?(fragment, link); return true }) })
      }
      contentViews.append(label); view.addSubview(label)
    }
    view.setNeedsLayout()
  }
  func reference(at point: CGPoint) -> (Fragment, ReferenceMark)? {
    guard let page else { return nil }
    for (view, fragment) in zip(contentViews, page.fragments) {
      if let label = view as? ReadingReferenceLabel,
         let link = label.reference(at: label.convert(point, from: self.view)) { return (fragment, link) }
    }
    return nil
  }
  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    guard let page else { return }
    var top: CGFloat = 16
    for (content, fragment) in zip(contentViews, page.fragments) {
      content.frame = CGRect(x: page.horizontal, y: top, width: max(1, view.bounds.width - page.horizontal * 2), height: fragment.height)
      top += fragment.height + fragment.gap
    }
  }
  @objc private func longPress(_ gesture: UILongPressGestureRecognizer) {
    guard gesture.state == .began, let tag = gesture.view?.tag, let page, page.fragments.indices.contains(tag) else { return }
    select?(page.fragments[tag])
  }
}

final class ByPageReaderView: ExpoView, UIPageViewControllerDataSource, UIPageViewControllerDelegate, UIGestureRecognizerDelegate {
  let onPageChange = EventDispatcher()
  let onCenterTap = EventDispatcher()
  let onSelect = EventDispatcher()
  let onBoundary = EventDispatcher()
  let onImagePress = EventDispatcher()
  let onImageError = EventDispatcher()
  let onReferencePress = EventDispatcher()
  var pagesJSON = "[]"
  var targetIndex = 0
  var totalPages = 1
  var effect = "curl"
  var hasPrevious = false
  var hasNext = false
  private var decodedJSON = ""
  private var pages: [Int: Page] = [:]
  private var controller: UIPageViewController?
  private var activeEffect = ""
  private var turning = false
  private var currentIndex = 0

  override func didMoveToWindow() { super.didMoveToWindow(); if window == nil { detach() } else { update() } }
  override func layoutSubviews() { super.layoutSubviews(); controller?.view.frame = bounds }
  private func detach() {
    controller?.willMove(toParent: nil); controller?.view.removeFromSuperview(); controller?.removeFromParent(); controller = nil; turning = false
  }
  private func parentController() -> UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next { if let parent = next as? UIViewController { return parent }; responder = next }
    return nil
  }
  func update() {
    if decodedJSON != pagesJSON, let data = pagesJSON.data(using: .utf8), data.count <= 2 * 1024 * 1024,
       let decoded = try? JSONDecoder().decode([Page].self, from: data) {
      pages = Dictionary(decoded.map { ($0.index, $0) }, uniquingKeysWith: { _, last in last }); decodedJSON = pagesJSON
    }
    guard window != nil, !pages.isEmpty else { return }
    if controller == nil || activeEffect != effect {
      detach()
      guard let parent = parentController() else { return }
      let value = UIPageViewController(transitionStyle: effect == "curl" ? .pageCurl : .scroll, navigationOrientation: .horizontal, options: effect == "curl" ? [UIPageViewController.OptionsKey.spineLocation: UIPageViewController.SpineLocation.min.rawValue] : nil)
      value.dataSource = self; value.delegate = self; value.isDoubleSided = false
      parent.addChild(value); addSubview(value.view); value.view.frame = bounds; value.didMove(toParent: parent)
      controller = value; activeEffect = effect; currentIndex = min(max(0, targetIndex), totalPages - 1)
      value.setViewControllers([makePage(currentIndex)], direction: .forward, animated: false)
      // UIKit's curl controller also installs edge taps; let our shared tap zones own those.
      value.gestureRecognizers.compactMap { $0 as? UITapGestureRecognizer }.forEach { $0.isEnabled = false }
      let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:))); tap.cancelsTouchesInView = false; tap.delegate = self; value.view.addGestureRecognizer(tap)
      if effect == "none" {
        value.gestureRecognizers.forEach { $0.isEnabled = false }
        value.view.subviews.compactMap { $0 as? UIScrollView }.forEach { $0.isScrollEnabled = false }
        for direction: UISwipeGestureRecognizer.Direction in [.left, .right] {
          let swipe = UISwipeGestureRecognizer(target: self, action: #selector(swiped(_:))); swipe.direction = direction; value.view.addGestureRecognizer(swipe)
        }
      }
    }
    guard let controller, !turning else { return }
    let wanted = min(max(0, targetIndex), totalPages - 1)
    guard pages[wanted] != nil else { return }
    if wanted != currentIndex {
      let direction: UIPageViewController.NavigationDirection = wanted > currentIndex ? .forward : .reverse
      currentIndex = wanted; turning = true
      controller.setViewControllers([makePage(wanted)], direction: direction, animated: effect != "none" && !UIAccessibility.isReduceMotionEnabled) { [weak self] _ in self?.turning = false; self?.update() }
    } else if let shown = controller.viewControllers?.first as? ReadingPageController, shown.index == currentIndex {
      shown.update(pages[currentIndex])
    }
  }
  private func makePage(_ index: Int) -> ReadingPageController {
    let value = ReadingPageController(index: index, page: pages[index] ?? pages[currentIndex].map { Page(index: index, background: $0.background, highlight: $0.highlight, horizontal: $0.horizontal, rtl: $0.rtl, referenceColor: $0.referenceColor, fragments: []) })
    value.select = { [weak self] fragment in
      guard let id = fragment.paragraph else { return }
      self?.onSelect(["paragraph": id, "source": fragment.source, "start": fragment.start, "end": fragment.end])
    }
    value.openImage = { [weak self] placementId in self?.onImagePress(["placementId": placementId]) }
    value.imageError = { [weak self] placementId in self?.onImageError(["placementId": placementId]) }
    value.openReference = { [weak self] fragment, link in self?.emitReference(fragment, link) }
    return value
  }
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    var touched = touch.view
    while let view = touched, view !== self {
      if view is UIControl { return false }
      touched = view.superview
    }
    return true
  }
  private var rtl: Bool { pages[currentIndex]?.rtl == true }
  private func emitReference(_ fragment: Fragment, _ link: ReferenceMark) {
    guard let paragraph = fragment.paragraph else { return }
    onReferencePress(["id": link.id, "paragraph": paragraph, "start": fragment.start + link.start])
  }
  private func advance(_ delta: Int) {
    guard !turning else { return }
    let next = currentIndex + delta
    if next < 0 || next >= totalPages { onBoundary(["direction": delta]); return }
    guard pages[next] != nil else { return }
    targetIndex = next; onPageChange(["index": next]); update()
  }
  @objc private func tapped(_ gesture: UITapGestureRecognizer) {
    guard !turning else { return }
    if let shown = controller?.viewControllers?.first as? ReadingPageController,
       let (fragment, link) = shown.reference(at: gesture.location(in: shown.view)) {
      emitReference(fragment, link); return
    }
    let x = gesture.location(in: self).x
    if x < bounds.width * 0.22 { advance(rtl ? 1 : -1) }
    else if x > bounds.width * 0.78 { advance(rtl ? -1 : 1) }
    else { onCenterTap([:]) }
  }
  @objc private func swiped(_ gesture: UISwipeGestureRecognizer) { advance((gesture.direction == .left ? 1 : -1) * (rtl ? -1 : 1)) }
  func pageViewController(_ pageViewController: UIPageViewController, viewControllerBefore viewController: UIViewController) -> UIViewController? {
    guard effect != "none", let page = viewController as? ReadingPageController else { return nil }
    let index = page.index + (rtl ? 1 : -1)
    if index == -1 && hasPrevious || index == totalPages && hasNext { return makePage(index) }
    return pages[index] != nil ? makePage(index) : nil
  }
  func pageViewController(_ pageViewController: UIPageViewController, viewControllerAfter viewController: UIViewController) -> UIViewController? {
    guard effect != "none", let page = viewController as? ReadingPageController else { return nil }
    let index = page.index + (rtl ? -1 : 1)
    if index == -1 && hasPrevious || index == totalPages && hasNext { return makePage(index) }
    return pages[index] != nil ? makePage(index) : nil
  }
  func pageViewController(_ pageViewController: UIPageViewController, willTransitionTo pendingViewControllers: [UIViewController]) { turning = true }
  func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool, previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
    turning = false
    guard completed, let shown = pageViewController.viewControllers?.first as? ReadingPageController else { update(); return }
    if shown.index < 0 || shown.index >= totalPages {
      pageViewController.setViewControllers([makePage(currentIndex)], direction: .forward, animated: false)
      onBoundary(["direction": shown.index < 0 ? -1 : 1]); return
    }
    currentIndex = shown.index; targetIndex = shown.index; onPageChange(["index": shown.index])
  }
}
private struct SelectionContent: Decodable {
  let id: String
  let text: String
  let start: Int
  let end: Int
  let fontSize: Double
  let lineHeight: Double
  let serif: Bool
  let foreground: String
  let background: String
  let accent: String
  let label: String
}

/** A dedicated read-only text surface keeps system selection gestures outside the page turner. */
final class ByPageSelectionView: ExpoView, UITextViewDelegate {
  let onSelectionChange = EventDispatcher()
  let onSelectionError = EventDispatcher()
  var contentJSON = ""
  private let textView = UITextView()
  private var content: SelectionContent?
  private var decodedJSON = ""
  private var needsInitialSelection = false
  private var applying = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    textView.delegate = self
    textView.isEditable = false
    textView.isSelectable = true
    textView.isScrollEnabled = true
    textView.alwaysBounceVertical = true
    textView.dataDetectorTypes = []
    textView.textContainerInset = UIEdgeInsets(top: 20, left: 22, bottom: 24, right: 22)
    textView.textContainer.lineFragmentPadding = 0
    textView.adjustsFontForContentSizeCategory = false
    textView.accessibilityTraits.insert(.staticText)
    if #available(iOS 18.0, *) { textView.writingToolsBehavior = .none }
    addSubview(textView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    textView.frame = bounds
    applyInitialSelection()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { textView.resignFirstResponder() }
    else { setNeedsLayout() }
  }

  func update() {
    guard contentJSON != decodedJSON else { return }
    decodedJSON = contentJSON
    guard let data = contentJSON.data(using: .utf8), data.count <= 800000,
      let value = try? JSONDecoder().decode(SelectionContent.self, from: data),
      !value.id.isEmpty, value.id.utf8.count <= 128,
      !value.text.isEmpty, (value.text as NSString).length <= 100000,
      value.start >= 0, value.end >= value.start, value.end <= (value.text as NSString).length,
      value.fontSize.isFinite, value.lineHeight.isFinite
    else {
      content = nil; applying = true; textView.text = ""; applying = false
      onSelectionError([:]); return
    }
    // A theme update must not reset handles the reader has already moved.
    let previous = selectionRange()
    let newContent = content?.id != value.id || content?.text != value.text
    content = value
    applying = true
    let size = max(15, min(30, value.fontSize))
    let font = value.serif ? UIFont(name: "Georgia", size: size) ?? .systemFont(ofSize: size) : .systemFont(ofSize: size)
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineHeightMultiple = max(1.2, min(2.2, value.lineHeight))
    paragraph.alignment = .natural
    paragraph.baseWritingDirection = .natural
    textView.attributedText = NSAttributedString(string: value.text, attributes: [
      .font: font, .foregroundColor: color(value.foreground), .paragraphStyle: paragraph,
    ])
    textView.backgroundColor = color(value.background)
    textView.tintColor = color(value.accent)
    textView.accessibilityLabel = value.label
    if newContent {
      needsInitialSelection = true
    } else if let previous {
      setSelection(previous)
    }
    applying = false
    setNeedsLayout()
  }

  private func safeRange(_ start: Int, _ end: Int) -> NSRange? {
    guard let content else { return nil }
    let text = content.text as NSString
    guard start >= 0, end >= start, end <= text.length else { return nil }
    var from = start, to = end
    // UITextInput offsets and JavaScript slice both use UTF-16. Never split a surrogate pair.
    if from > 0, from < text.length,
      (0xDC00...0xDFFF).contains(text.character(at: from)),
      (0xD800...0xDBFF).contains(text.character(at: from - 1)) { from -= 1 }
    if start == end { return NSRange(location: from, length: 0) }
    if to > 0, to < text.length,
      (0xDC00...0xDFFF).contains(text.character(at: to)),
      (0xD800...0xDBFF).contains(text.character(at: to - 1)) { to += 1 }
    return NSRange(location: from, length: to - from)
  }

  private func setSelection(_ range: NSRange) {
    guard let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
      let end = textView.position(from: start, offset: range.length),
      let selected = textView.textRange(from: start, to: end) else { return }
    textView.selectedTextRange = selected
  }

  private func selectionRange() -> NSRange? {
    guard let selected = textView.selectedTextRange else { return nil }
    return safeRange(textView.offset(from: textView.beginningOfDocument, to: selected.start),
      textView.offset(from: textView.beginningOfDocument, to: selected.end))
  }

  private func applyInitialSelection() {
    guard needsInitialSelection, window != nil, bounds.width > 0, bounds.height > 0,
      let content, let range = safeRange(content.start, content.end) else { return }
    needsInitialSelection = false
    applying = true
    // Read-only selectable UITextView shows native handles without opening a keyboard.
    textView.becomeFirstResponder()
    setSelection(range)
    textView.layoutIfNeeded()
    textView.scrollRangeToVisible(NSRange(location: range.location, length: 0))
    applying = false
    publish()
  }

  func getSelection() -> [String: Any]? {
    guard window != nil, !needsInitialSelection, let content,
      textView.text == content.text, let range = selectionRange() else { return nil }
    return ["id": content.id, "start": range.location, "end": NSMaxRange(range)]
  }

  private func publish() {
    if !applying, let value = getSelection() { onSelectionChange(value) }
  }

  func textViewDidChangeSelection(_ textView: UITextView) { publish() }
  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool { false }
}

private struct ProgressSliderContent: Decodable {
  let id: String
  let commandId: String
  let value: Int
  let maximum: Int
  let label: String
  let valueLabel: String
  let hint: String
  let accent: String
  let track: String
  let enabled: Bool
}

/** Accessibility adjusts a whole paragraph, just like the explicit step buttons. */
private final class ParagraphProgressSlider: UISlider {
  override func accessibilityIncrement() { step(1) }
  override func accessibilityDecrement() { step(-1) }
  private func step(_ delta: Float) {
    guard isEnabled else { return }
    setValue(max(minimumValue, min(maximumValue, value.rounded() + delta)), animated: false)
    sendActions(for: .valueChanged)
  }
}

/** This view only previews an ordinal. It never changes the reader or saves progress. */
final class ByPageProgressSliderView: ExpoView {
  let onValueChange = EventDispatcher()
  var contentJSON = ""
  private let slider = ParagraphProgressSlider()
  private var content: ProgressSliderContent?
  private var decodedJSON = ""
  private var sequence = 0
  private var lastPublished = -1

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    slider.isContinuous = true
    slider.addTarget(self, action: #selector(valueChanged), for: .valueChanged)
    addSubview(slider)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    slider.frame = bounds.insetBy(dx: min(2, bounds.width / 2), dy: 0)
  }

  func update() {
    guard contentJSON != decodedJSON else { return }
    decodedJSON = contentJSON
    guard let data = contentJSON.data(using: .utf8), data.count <= 16384,
      let value = try? JSONDecoder().decode(ProgressSliderContent.self, from: data),
      !value.id.isEmpty, value.id.utf8.count <= 128,
      !value.commandId.isEmpty, value.commandId.utf8.count <= 128,
      value.maximum >= 0, value.maximum <= 16777215,
      value.value >= 0, value.value <= value.maximum,
      value.label.utf8.count <= 1000, value.valueLabel.utf8.count <= 4000,
      value.hint.utf8.count <= 4000
    else {
      content = nil; slider.isEnabled = false; return
    }
    let changedSource = content?.id != value.id || content?.maximum != value.maximum
    let changedCommand = changedSource || content?.commandId != value.commandId
    content = value
    slider.minimumValue = 0
    // A one-paragraph book has no adjustable range, but still has a valid preview.
    slider.maximumValue = Float(max(1, value.maximum))
    slider.isEnabled = value.enabled && value.maximum > 0
    slider.minimumTrackTintColor = color(value.accent)
    slider.maximumTrackTintColor = color(value.track)
    slider.accessibilityLabel = value.label
    slider.accessibilityHint = value.hint
    if changedSource { sequence = 0 }
    // React echoes preview values after native events. Those are acknowledgements,
    // not commands: applying them could pull a live drag back to an older value.
    if changedCommand {
      slider.setValue(Float(value.value), animated: false)
      lastPublished = value.value
    }
    if Int(slider.value.rounded()) == value.value { slider.accessibilityValue = value.valueLabel }
  }

  func getValue() -> [String: Any]? {
    guard window != nil, let content else { return nil }
    return ["id": content.id, "commandId": content.commandId, "sequence": sequence,
      "value": max(0, min(content.maximum, Int(slider.value.rounded())))]
  }

  @objc private func valueChanged() {
    guard let content else { return }
    let value = max(0, min(content.maximum, Int(slider.value.rounded())))
    guard value != lastPublished else { return }
    lastPublished = value; sequence += 1
    // Until React supplies the localized preview, do not announce an older ordinal.
    slider.accessibilityValue = "\(value + 1) / \(content.maximum + 1)"
    if let snapshot = getValue() { onValueChange(snapshot) }
  }
}

public final class ByPageReaderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ByPageReader")
    Constants(["mediaVersion": 1, "referencesVersion": 1, "selectionVersion": 1, "progressSliderVersion": 1])
    View(ByPageReaderView.self) {
      Events("onPageChange", "onCenterTap", "onSelect", "onBoundary", "onImagePress", "onImageError", "onReferencePress")
      Prop("pagesJSON") { (view: ByPageReaderView, value: String) in view.pagesJSON = value }
      Prop("pageIndex") { (view: ByPageReaderView, value: Int) in view.targetIndex = value }
      Prop("totalPages") { (view: ByPageReaderView, value: Int) in view.totalPages = max(1, value) }
      Prop("effect") { (view: ByPageReaderView, value: String) in view.effect = ["curl", "slide", "none"].contains(value) ? value : "slide" }
      Prop("hasPrevious") { (view: ByPageReaderView, value: Bool) in view.hasPrevious = value }
      Prop("hasNext") { (view: ByPageReaderView, value: Bool) in view.hasNext = value }
      OnViewDidUpdateProps { (view: ByPageReaderView) in view.update() }
    }
    View(ByPageSelectionView.self) {
      ViewName("Selection")
      Events("onSelectionChange", "onSelectionError")
      Prop("contentJSON") { (view: ByPageSelectionView, value: String) in view.contentJSON = value }
      OnViewDidUpdateProps { (view: ByPageSelectionView) in view.update() }
      AsyncFunction("getSelection") { (view: ByPageSelectionView) -> [String: Any]? in view.getSelection() }
    }
    View(ByPageProgressSliderView.self) {
      ViewName("ProgressSlider")
      Events("onValueChange")
      Prop("contentJSON") { (view: ByPageProgressSliderView, value: String) in view.contentJSON = value }
      OnViewDidUpdateProps { (view: ByPageProgressSliderView) in view.update() }
      AsyncFunction("getValue") { (view: ByPageProgressSliderView) -> [String: Any]? in view.getValue() }
    }
  }
}
