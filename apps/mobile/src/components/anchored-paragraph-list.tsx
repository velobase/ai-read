import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  type CellRendererProps,
  type FlatListProps,
  type LayoutRectangle,
  type TextProps,
  type TextLayoutEventData,
} from 'react-native';
import { safeReadingQuote, type Paragraph, type Position } from '@bypage/reading-core';
import { createScrollDiagnostics } from '../adapters/diagnostics';

type Props = Omit<FlatListProps<Paragraph>, 'data' | 'initialScrollIndex' | 'getItemLayout'> & {
  items: Paragraph[];
  anchor: Pick<Position, 'paragraph' | 'textOffset' | 'textSource' | 'textQuote'>;
  onRestoring?: () => void;
  onRestored?: () => void;
  onScrollIdle?: () => void;
  captureRef?: RefObject<VisibleAnchorCapture | null>;
};
export type VisibleAnchor = Pick<Position, 'paragraph' | 'textOffset' | 'textSource' | 'textQuote'>;
export type VisibleAnchorCapture = {
  capture: (options?: {
    timeoutMs?: number;
    preserveRestored?: boolean;
  }) => Promise<VisibleAnchor | null>;
};
type CaptureGeometry = {
  top: number;
  height: number;
  content: number;
  revision: number;
  sourceRevision: number;
};
type CaptureRequest = CaptureGeometry & {
  id: number;
  bottom: number;
  cells: Map<string, number>;
  texts: Map<string, string>;
};
type CapturedLine = VisibleAnchor & { y: number; fullyVisible: boolean; visibleFraction: number };
type CapturedAnchor = { request: CaptureGeometry; anchor: VisibleAnchor };
const CaptureContext = createContext<{
  request: CaptureRequest | null;
  register: (key: string, paragraph: string, text: string) => () => void;
  report: (id: number, key: string, text: string, line: CapturedLine | null) => void;
} | null>(null);
type CellLayout = (id: string, index: number, layout: LayoutRectangle | null) => void;
const LayoutContext = createContext<CellLayout>(() => {});
const CellViewContext = createContext<RefObject<View | null> | null>(null);
const InlineAnchorContext = createContext<{
  anchor: Props['anchor'];
  active: boolean;
  report: (y: number) => void;
} | null>(null);
const NEIGHBORHOOD = 12;

function MeasuredCell({
  item,
  index,
  children,
  style,
  onLayout,
  onFocusCapture,
}: CellRendererProps<Paragraph>) {
  const measure = useContext(LayoutContext);
  const cell = useRef<View>(null);
  useEffect(() => () => measure(item.id, -1, null), [item.id, measure]);
  return (
    <CellViewContext.Provider value={cell}>
      <View
        ref={cell}
        collapsable={false}
        style={style}
        // FlatList uses this capture callback; RN's public ViewProps omits its type.
        {...{ onFocusCapture }}
        onLayout={(event) => {
          onLayout?.(event);
          measure(item.id, index, event.nativeEvent.layout);
        }}
      >
        {children}
      </View>
    </CellViewContext.Provider>
  );
}

/** Only the requested source emits line data, and only until its initial jump settles. */
export function AnchorPassageText({
  paragraph,
  source,
  text,
  children,
  onLayout,
  ...props
}: Omit<TextProps, 'onTextLayout'> & {
  paragraph: string;
  source: 'original' | 'translation';
  text: string;
}) {
  const anchor = useContext(InlineAnchorContext);
  const cell = useContext(CellViewContext);
  const capture = useContext(CaptureContext);
  const captureKey = `${paragraph}:${source}`;
  const captureRequest = capture?.request?.cells.has(paragraph) ? capture.request : null;
  const view = useRef<Text>(null);
  const lineY = useRef<number | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  useLayoutEffect(
    () => capture?.register(captureKey, paragraph, text),
    [capture?.register, captureKey, paragraph, text],
  );
  const active =
    !!anchor?.active &&
    anchor.anchor.paragraph === paragraph &&
    (anchor.anchor.textSource || 'original') === source;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!active) {
      lineY.current = null;
      generation.current++;
    }
  }, [active]);
  const measureLine = () => {
    if (!active || lineY.current === null || !view.current || !cell?.current) return;
    const token = ++generation.current;
    const y = lineY.current;
    // Measure against the actual cell: this includes a chapter heading, original
    // text and bilingual gaps without guessing their heights.
    view.current.measureLayout(cell.current, (_x, top) => {
      if (mounted.current && token === generation.current && Number.isFinite(top))
        anchor.report(Math.max(0, top + y));
    });
  };
  const reportCapture = (lines: TextLayoutEventData['lines']) => {
    if (!captureRequest || !capture || !view.current || !cell?.current) return;
    const request = captureRequest;
    view.current.measureLayout(
      cell.current,
      (_x, top) => {
        let cursor = 0;
        let match: CapturedLine | null = null;
        for (const line of lines) {
          const found = text.indexOf(line.text, cursor);
          const start = found >= cursor ? found : cursor;
          cursor = Math.min(text.length, start + line.text.length);
          const y = (request.cells.get(paragraph) || 0) + top + line.y;
          if (line.text.trim() && y + line.height > request.top + 1 && y < request.bottom) {
            const fullyVisible = y >= request.top - 0.5 && y + line.height <= request.bottom + 0.5;
            const visibleFraction =
              (Math.min(y + line.height, request.bottom) - Math.max(y, request.top)) /
              Math.max(1, line.height);
            const candidate: CapturedLine = {
              paragraph,
              textSource: source,
              textOffset: start,
              textQuote: safeReadingQuote(text, start),
              y,
              fullyVisible,
              visibleFraction,
            };
            // The restore margin may expose a sliver of the preceding line. It
            // must not move the next capture backwards on every typography change.
            if (fullyVisible) {
              match = candidate;
              break;
            }
            if (!match || visibleFraction > match.visibleFraction) match = candidate;
          }
        }
        // Line arrays exist only for this on-demand measurement, never a book-wide cache.
        capture.report(request.id, captureKey, text, match);
      },
      () => capture.report(request.id, captureKey, text, null),
    );
  };
  return (
    <Text
      {...props}
      // A fresh native Text requests its real line layout even when typography is unchanged.
      key={captureRequest?.id || 0}
      ref={view}
      onLayout={
        active
          ? (event) => {
              onLayout?.(event);
              measureLine();
            }
          : onLayout
      }
      onTextLayout={
        active || !!captureRequest
          ? (event) => {
              if (captureRequest) reportCapture(event.nativeEvent.lines);
              if (!active || !anchor) return;
              const offset = Math.max(0, Math.min(text.length - 1, anchor.anchor.textOffset || 0));
              let cursor = 0;
              let y = event.nativeEvent.lines.at(-1)?.y || 0;
              for (const line of event.nativeEvent.lines) {
                const found = text.indexOf(line.text, cursor);
                const start = found >= cursor ? found : cursor;
                const end = Math.min(text.length, start + line.text.length);
                if (offset < end || offset <= start) {
                  y = line.y;
                  break;
                }
                cursor = end;
              }
              // Do not retain the line array or duplicate the source text in a cache.
              lineY.current = y;
              measureLine();
            }
          : undefined
      }
    >
      {children}
    </Text>
  );
}

/** Restore from native measurements, never an estimated variable-height scrollToIndex.
 * The first batch includes the anchor. Older rows are added in small batches so the
 * native visible cell remains mounted, without a large estimated spacer before it.
 */
export function AnchoredParagraphList({
  items,
  anchor,
  onRestoring,
  onRestored,
  onScrollIdle,
  captureRef,
  ...props
}: Props) {
  const [restoreAnchor] = useState(() =>
    items.some((item) => item.id === anchor.paragraph)
      ? anchor
      : { paragraph: items[0]?.id || '', textOffset: 0, textSource: 'original' as const },
  );
  const needsInline =
    restoreAnchor.textSource === 'translation' || (restoreAnchor.textOffset || 0) > 0;
  const inlineY = useRef<number | null>(needsInline ? null : 0);
  const mounted = useRef(true);
  const [target] = useState(() =>
    Math.max(
      0,
      items.findIndex((item) => item.id === restoreAnchor.paragraph),
    ),
  );
  const [start, setStart] = useState(Math.max(0, target - NEIGHBORHOOD));
  const data = useMemo(() => items.slice(start), [items, start]);
  const startRef = useRef(start);
  startRef.current = start;
  const propsRef = useRef({ ...props, onRestoring, onRestored, onScrollIdle });
  propsRef.current = { ...props, onRestoring, onRestored, onScrollIdle };
  const list = useRef<FlatList<Paragraph>>(null);
  const layouts = useRef(new Map<string, LayoutRectangle & { index: number }>());
  const layoutRevision = useRef(0);
  const metrics = useRef({ offset: 0, height: 0, content: 0 });
  const visible = useRef<Parameters<NonNullable<Props['onViewableItemsChanged']>>[0] | null>(null);
  const restoring = useRef(true);
  const [restored, setRestored] = useState(false);
  const moving = useRef(false);
  const userScrolled = useRef(false);
  const idleDirty = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<{ id: string; index: number } | null>(null);
  const [diagnostics] = useState(createScrollDiagnostics);
  const scrollMetrics = (offset = metrics.current.offset) => ({
    offset,
    contentHeight: metrics.current.content,
    viewportHeight: metrics.current.height,
    restoring: restoring.current,
    pending: !!pending.current,
  });
  const sources = useRef(new Map<string, { paragraph: string; text: string }>());
  const sourceRevision = useRef(0);
  const captured = useRef<CapturedAnchor | null>(null);
  const restoredCapture = useRef<CapturedAnchor | null>(null);
  const [captureRequest, setCaptureRequest] = useState<CaptureRequest | null>(null);
  const captureId = useRef(0);
  const capturing = useRef<{
    request: CaptureRequest;
    expected: Set<string>;
    lines: CapturedLine[];
    promise: Promise<VisibleAnchor | null>;
    resolve: (anchor: VisibleAnchor | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const currentCapture = useCallback((cached: CapturedAnchor | null = captured.current) => {
    return cached &&
      !moving.current &&
      !pending.current &&
      !restoring.current &&
      Math.abs(metrics.current.offset - cached.request.top) <= 1 &&
      metrics.current.height === cached.request.height &&
      metrics.current.content === cached.request.content &&
      layoutRevision.current === cached.request.revision &&
      sourceRevision.current === cached.request.sourceRevision
      ? cached.anchor
      : null;
  }, []);
  const finishCapture = useCallback(() => {
    const work = capturing.current;
    if (!work) return;
    capturing.current = null;
    clearTimeout(work.timer);
    if (mounted.current) setCaptureRequest(null);
    const unchanged =
      mounted.current &&
      !work.expected.size &&
      Math.abs(metrics.current.offset - work.request.top) <= 1 &&
      metrics.current.height === work.request.height &&
      metrics.current.content === work.request.content &&
      layoutRevision.current === work.request.revision &&
      sourceRevision.current === work.request.sourceRevision &&
      !moving.current &&
      !pending.current &&
      !restoring.current;
    // Choose across all visible paragraphs and both sources, not just within
    // one Text. A previous source's sliver cannot outrank the next complete line.
    const line = unchanged
      ? work.lines.sort(
          (a, b) =>
            Number(b.fullyVisible) - Number(a.fullyVisible) ||
            (!a.fullyVisible ? b.visibleFraction - a.visibleFraction : 0) ||
            a.y - b.y,
        )[0]
      : null;
    const anchor = line
      ? {
          paragraph: line.paragraph,
          textSource: line.textSource,
          textOffset: line.textOffset,
          textQuote: line.textQuote,
        }
      : null;
    if (anchor) captured.current = { request: work.request, anchor };
    work.resolve(anchor);
  }, []);
  const registerCapture = useCallback((key: string, paragraph: string, text: string) => {
    sources.current.set(key, { paragraph, text });
    sourceRevision.current++;
    return () => {
      sources.current.delete(key);
      sourceRevision.current++;
    };
  }, []);
  const reportCapture = useCallback(
    (id: number, key: string, text: string, line: CapturedLine | null) => {
      const work = capturing.current;
      if (!work || work.request.id !== id) return;
      if (work.request.texts.get(key) !== text || sources.current.get(key)?.text !== text) {
        finishCapture();
        return;
      }
      if (!work.expected.delete(key)) return;
      if (line) work.lines.push(line);
      if (!work.expected.size) finishCapture();
    },
    [finishCapture],
  );
  useImperativeHandle(
    captureRef,
    () => ({
      capture: (options) => {
        if (restoring.current || pending.current || moving.current || !mounted.current)
          return Promise.resolve(null);
        if (options?.preserveRestored) {
          const restored = currentCapture(restoredCapture.current);
          if (restored) return Promise.resolve(restored);
        }
        const cached = currentCapture();
        if (cached) return Promise.resolve(cached);
        const bounded = (promise: Promise<VisibleAnchor | null>) => {
          const wait = options?.timeoutMs;
          if (wait === undefined || !Number.isFinite(wait) || wait >= 700) return promise;
          return new Promise<VisibleAnchor | null>((resolve) => {
            const timeout = setTimeout(() => resolve(null), Math.max(0, wait));
            void promise.then((anchor) => {
              clearTimeout(timeout);
              resolve(anchor);
            });
          });
        };
        // Automatic persistence, bookmarks and appearance changes can share one
        // stable native measurement; a short UI deadline does not cancel its peers.
        if (capturing.current) return bounded(capturing.current.promise);
        const { offset, height } = metrics.current;
        const cells = new Map(
          [...layouts.current.entries()]
            .filter(
              ([id, layout]) =>
                data[layout.index]?.id === id &&
                layout.y + layout.height > offset &&
                layout.y < offset + height,
            )
            .map(([id, layout]) => [id, layout.y]),
        );
        const texts = new Map(
          [...sources.current]
            .filter(([, source]) => cells.has(source.paragraph))
            .map(([key, source]) => [key, source.text]),
        );
        const expected = new Set(texts.keys());
        if (!expected.size) return Promise.resolve(null);
        const request = {
          id: ++captureId.current,
          top: offset,
          bottom: offset + height,
          height,
          content: metrics.current.content,
          revision: layoutRevision.current,
          sourceRevision: sourceRevision.current,
          cells,
          texts,
        };
        let resolve!: (anchor: VisibleAnchor | null) => void;
        const promise = new Promise<VisibleAnchor | null>((done) => {
          resolve = done;
        });
        capturing.current = {
          request,
          expected,
          lines: [],
          promise,
          resolve,
          timer: setTimeout(finishCapture, 700),
        };
        setCaptureRequest(request);
        return bounded(promise);
      },
    }),
    [data, finishCapture, currentCapture],
  );
  const captureContext = useMemo(
    () => ({ request: captureRequest, register: registerCapture, report: reportCapture }),
    [captureRequest, registerCapture, reportCapture],
  );
  const footerHeight = useRef(0);
  const [footerVisible, setFooterVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const settleRef = useRef<() => void>(() => {});
  const schedule = useCallback(() => {
    // Scroll events arrive faster than this delay. Debouncing them would leave a
    // prepend pending for the whole gesture and discard its final reading position.
    if (timer.current !== undefined || frame.current !== undefined) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      settleRef.current();
    }, 48);
  }, []);
  const scheduleIdle = useCallback(() => {
    clearTimeout(idleTimer.current);
    if (!idleDirty.current || moving.current || pending.current || restoring.current) return;
    idleTimer.current = setTimeout(() => {
      idleTimer.current = undefined;
      if (!mounted.current || moving.current || pending.current || restoring.current) return;
      idleDirty.current = false;
      propsRef.current.onScrollIdle?.();
    }, 250);
  }, []);
  const updateFooterVisibility = () => {
    const { offset, height, content } = metrics.current;
    const style = StyleSheet.flatten(propsRef.current.contentContainerStyle);
    const padding = style?.paddingBottom ?? style?.paddingVertical ?? style?.padding;
    const bottomPadding = typeof padding === 'number' ? padding : 0;
    setFooterVisible(
      height > 0 &&
        content > 0 &&
        footerHeight.current > 0 &&
        offset + height > content - bottomPadding - footerHeight.current,
    );
  };
  const publishVisible = () => {
    const info = visible.current;
    // Geometry may report an image-only cell before the first visible text line.
    // Once a precise capture covers this unchanged viewport, do not downgrade it.
    if (!info || !userScrolled.current || currentCapture()) return;
    const { offset, height } = metrics.current;
    const viewableItems = info.viewableItems.flatMap((entry) => {
      const layout = layouts.current.get(entry.item.id);
      return layout &&
        data[layout.index]?.id === entry.item.id &&
        layout.y + layout.height > offset &&
        layout.y < offset + height
        ? [{ ...entry, index: layout.index }]
        : [];
    });
    if (viewableItems.length) propsRef.current.onViewableItemsChanged?.({ ...info, viewableItems });
  };
  const publishVisibleRef = useRef(publishVisible);
  publishVisibleRef.current = publishVisible;
  const firstVisibleLayout = () => {
    const { offset, height } = metrics.current;
    return [...layouts.current.entries()]
      .filter(
        ([id, layout]) =>
          data[layout.index]?.id === id &&
          layout.y + layout.height > offset &&
          layout.y < offset + height,
      )
      .sort((a, b) => a[1].y - b[1].y)[0];
  };

  useEffect(() => {
    mounted.current = true;
    diagnostics.record('mount', scrollMetrics());
    propsRef.current.onRestoring?.();
    return () => {
      mounted.current = false;
      diagnostics.record('unmount', scrollMetrics());
      finishCapture();
      clearTimeout(idleTimer.current);
      clearTimeout(timer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, []);

  settleRef.current = () => {
    const restoration = restoring.current;
    const hold = pending.current;
    if (!restoration && !hold) return;
    const id = hold?.id || items[target]?.id;
    let layout = id ? layouts.current.get(id) : undefined;
    // A fast drag can virtualize the held row away before the batch settles.
    // Any visible row measured at its new data index proves the prepend committed.
    if (hold && layout?.index !== hold.index) layout = firstVisibleLayout()?.[1];
    const viewport = metrics.current;
    if (!layout || !viewport.height || !viewport.content) return;
    if (restoration) {
      if (inlineY.current === null) return;
      // All preceding rows are in the initial batch. Wait for their real heights,
      // otherwise a later cell layout can change the target after we have scrolled.
      for (let index = 0; index <= target - startRef.current; index++) {
        if (layouts.current.get(data[index]?.id)?.index !== index) return;
      }
    }
    // MVCP owns prepend compensation. A second JS scroll to the old relative Y
    // would undo movement made while the new rows were being mounted.
    if (restoration) {
      const desired = Math.max(
        0,
        Math.min(
          Math.max(0, viewport.content - viewport.height),
          target === 0 && !needsInline ? 0 : layout.y + (inlineY.current || 0) - 12,
        ),
      );
      if (Math.abs(viewport.offset - desired) > 1) {
        diagnostics.sample('restoreCommand', scrollMetrics(), desired);
        list.current?.scrollToOffset({ offset: desired, animated: false });
        return;
      }
    }
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    const revision = layoutRevision.current;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      if (restoration && revision !== layoutRevision.current) {
        schedule();
        return;
      }
      if (restoration) {
        restoring.current = false;
        setRestored(true);
        const source = restoreAnchor.textSource || 'original';
        const text = sources.current.get(`${restoreAnchor.paragraph}:${source}`)?.text;
        const offset = restoreAnchor.textOffset || 0;
        if (
          text &&
          Number.isSafeInteger(offset) &&
          offset >= 0 &&
          offset < text.length &&
          (!restoreAnchor.textQuote ||
            text.slice(offset, offset + restoreAnchor.textQuote.length) === restoreAnchor.textQuote)
        ) {
          restoredCapture.current = {
            request: {
              top: metrics.current.offset,
              height: metrics.current.height,
              content: metrics.current.content,
              revision: layoutRevision.current,
              sourceRevision: sourceRevision.current,
            },
            anchor: {
              paragraph: restoreAnchor.paragraph,
              textSource: source,
              textOffset: offset,
              textQuote: safeReadingQuote(text, offset),
            },
          };
        }
        diagnostics.record('restoreEnd', scrollMetrics());
        propsRef.current.onRestored?.();
      }
      if (hold && hold === pending.current) {
        pending.current = null;
        diagnostics.record('prependEnd', scrollMetrics());
        // Viewability may have settled while the native prepend was still pending.
        // Replay only rows whose current native geometry is actually in the viewport.
        publishVisibleRef.current();
        scheduleIdle();
      }
    });
  };

  const reportInline = useCallback(
    (y: number) => {
      if (!mounted.current || !restoring.current || !Number.isFinite(y)) return;
      if (inlineY.current !== y) layoutRevision.current++;
      inlineY.current = y;
      schedule();
    },
    [schedule],
  );
  const inlineAnchor = useMemo(
    () =>
      needsInline
        ? {
            anchor: restoreAnchor,
            active: !restored,
            report: reportInline,
          }
        : null,
    [needsInline, restoreAnchor, restored, reportInline],
  );

  const measure = useCallback<CellLayout>(
    (id, index, layout) => {
      if (layout) {
        const previous = layouts.current.get(id);
        layouts.current.set(id, { ...layout, index });
        if (
          !previous ||
          previous.index !== index ||
          previous.x !== layout.x ||
          previous.y !== layout.y ||
          previous.width !== layout.width ||
          previous.height !== layout.height
        )
          layoutRevision.current++;
        schedule();
      } else if (layouts.current.delete(id)) layoutRevision.current++;
    },
    [schedule],
  );
  const viewChanged = useCallback<NonNullable<Props['onViewableItemsChanged']>>((info) => {
    visible.current = info;
    // Opening a chapter, mode changes and native prepend compensation are not reading.
    // Do not overwrite the saved anchor with their intermediate first-visible rows.
    if (!restoring.current && !pending.current && userScrolled.current) publishVisibleRef.current();
  }, []);

  const prepend = () => {
    if (restoring.current || pending.current || startRef.current === 0) return;
    // Delayed viewability callbacks can still name the row from 180 ms ago.
    const first = firstVisibleLayout();
    if (!first) return;
    const [id, layout] = first;
    const nextStart = Math.max(0, startRef.current - NEIGHBORHOOD);
    pending.current = {
      id,
      index: layout.index + startRef.current - nextStart,
    };
    diagnostics.record('prependStart', scrollMetrics());
    setStart(nextStart);
  };
  const Footer = props.ListFooterComponent;

  return (
    <LayoutContext.Provider value={measure}>
      <InlineAnchorContext.Provider value={inlineAnchor}>
        <CaptureContext.Provider value={captureContext}>
          <FlatList
            {...props}
            ref={list}
            style={[{ flex: 1 }, props.style]}
            data={data}
            ListFooterComponent={
              Footer ? (
                <View
                  accessibilityElementsHidden={!footerVisible}
                  importantForAccessibility={footerVisible ? 'auto' : 'no-hide-descendants'}
                  onLayout={(event) => {
                    footerHeight.current = event.nativeEvent.layout.height;
                    updateFooterVisibility();
                  }}
                >
                  {isValidElement(Footer) ? Footer : <Footer />}
                </View>
              ) : null
            }
            CellRendererComponent={MeasuredCell}
            initialNumToRender={NEIGHBORHOOD + 6}
            maxToRenderPerBatch={8}
            windowSize={7}
            removeClippedSubviews={false}
            maintainVisibleContentPosition={restored ? { minIndexForVisible: 0 } : undefined}
            scrollEventThrottle={16}
            onViewableItemsChanged={viewChanged}
            onTouchStart={(event) => {
              diagnostics.touchStart(
                event.nativeEvent.pageX,
                event.nativeEvent.pageY,
                scrollMetrics(),
              );
              propsRef.current.onTouchStart?.(event);
            }}
            onTouchMove={(event) => {
              diagnostics.touchMove(
                event.nativeEvent.pageX,
                event.nativeEvent.pageY,
                scrollMetrics(),
              );
              propsRef.current.onTouchMove?.(event);
            }}
            onTouchEnd={(event) => {
              diagnostics.touchEnd(
                false,
                event.nativeEvent.pageX,
                event.nativeEvent.pageY,
                scrollMetrics(),
              );
              propsRef.current.onTouchEnd?.(event);
            }}
            onTouchCancel={(event) => {
              diagnostics.touchEnd(
                true,
                event.nativeEvent.pageX,
                event.nativeEvent.pageY,
                scrollMetrics(),
              );
              propsRef.current.onTouchCancel?.(event);
            }}
            onLayout={(event) => {
              if (metrics.current.height !== event.nativeEvent.layout.height)
                layoutRevision.current++;
              metrics.current.height = event.nativeEvent.layout.height;
              diagnostics.sample('layout', scrollMetrics());
              updateFooterVisibility();
              propsRef.current.onLayout?.(event);
              schedule();
            }}
            onContentSizeChange={(width, height) => {
              if (metrics.current.content !== height) layoutRevision.current++;
              metrics.current.content = height;
              diagnostics.sample('contentSize', scrollMetrics());
              updateFooterVisibility();
              propsRef.current.onContentSizeChange?.(width, height);
              schedule();
            }}
            onScroll={(event) => {
              const offset = event.nativeEvent.contentOffset.y;
              const previous = metrics.current.offset;
              metrics.current.offset = offset;
              diagnostics.sample('scroll', scrollMetrics());
              updateFooterVisibility();
              if (restoring.current || pending.current) schedule();
              else if (moving.current && offset !== previous) {
                userScrolled.current = true;
                idleDirty.current = true;
                captured.current = null;
                restoredCapture.current = null;
                // An earlier drag or an unrelated content-size update must not load history.
                if (offset < previous && offset < metrics.current.height * 0.6) prepend();
              }
              propsRef.current.onScroll?.(event);
            }}
            onScrollBeginDrag={(event) => {
              moving.current = true;
              captured.current = null;
              restoredCapture.current = null;
              finishCapture();
              clearTimeout(idleTimer.current);
              diagnostics.record('beginDrag', scrollMetrics(event.nativeEvent.contentOffset.y));
              // A deliberate gesture wins over a restore still waiting for native layout.
              if (restoring.current) {
                restoring.current = false;
                setRestored(true);
                clearTimeout(timer.current);
                timer.current = undefined;
                if (frame.current !== undefined) cancelAnimationFrame(frame.current);
                frame.current = undefined;
                diagnostics.record('restoreCancelled', scrollMetrics());
                propsRef.current.onRestored?.();
              }
              propsRef.current.onScrollBeginDrag?.(event);
            }}
            onScrollEndDrag={(event) => {
              moving.current = false;
              diagnostics.record('endDrag', scrollMetrics(event.nativeEvent.contentOffset.y));
              propsRef.current.onScrollEndDrag?.(event);
              scheduleIdle();
            }}
            onMomentumScrollBegin={(event) => {
              moving.current = true;
              captured.current = null;
              finishCapture();
              clearTimeout(idleTimer.current);
              diagnostics.record('momentumBegin', scrollMetrics(event.nativeEvent.contentOffset.y));
              propsRef.current.onMomentumScrollBegin?.(event);
            }}
            onMomentumScrollEnd={(event) => {
              moving.current = false;
              diagnostics.record('momentumEnd', scrollMetrics(event.nativeEvent.contentOffset.y));
              propsRef.current.onMomentumScrollEnd?.(event);
              scheduleIdle();
            }}
          />
        </CaptureContext.Provider>
      </InlineAnchorContext.Provider>
    </LayoutContext.Provider>
  );
}
