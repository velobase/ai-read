import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
  type TextStyle,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import {
  isPdfBook,
  type Book,
  type Chapter,
  type Paragraph,
  type Position,
  type Note,
} from '@bypage/reading-core';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { HighlightedPassage, passageRanges, type PassageSelection } from './passage';
import {
  NativePageView,
  nativeReaderSupportsImages,
  nativeReaderSupportsReferences,
} from './native-page-view';
import {
  referencesByParagraph,
  type ReadingReference,
  type ReferenceOrigin,
} from '../adapters/book-references';
import { bookImages, useBookImageFiles, type BookImageReference } from '../adapters/book-media';
import { BookImage, bookImageSize } from './book-image';

type Source = 'original' | 'translation';
type Run = {
  key: string;
  paragraph?: Paragraph;
  source: Source;
  text: string;
  style: TextStyle;
  lineHeight: number;
  image?: BookImageReference;
};
type Line = { text: string; start: number; end: number };
type Measurements = Map<string, { text: string; lines: Line[] }>;
type Fragment = { run: Run; text: string; start: number; end: number; height: number; gap: number };
type Page = { fragments: Fragment[] };
const noTranslations: Record<string, string> = {};
type Props = {
  book: Book;
  chapter: Chapter;
  translations: Record<string, string>;
  translationKeys: Record<string, string>;
  readingMode: 'original' | 'bilingual' | 'translation';
  readingLanguage?: string;
  anchor: Position;
  startAtEnd?: boolean;
  notes: Note[];
  onPosition: (id: string, textOffset: number, source: Source) => void;
  onReadyChange?: (ready: boolean) => void;
  onPage: (page: number, total: number) => void;
  onTap: () => void;
  onSelect: (selection: PassageSelection) => void;
  onBoundary: (direction: -1 | 1) => void;
  onImage: (image: BookImageReference) => void;
  onReference: (id: string, origin: ReferenceOrigin) => void;
  onReferences: (references: ReadingReference[]) => void;
};

/** Measures native text with the active font before composing pages; paragraph IDs survive reflow. */
export function PaginatedChapter(props: Props) {
  const { preferences: prefs } = useApp();
  const library = useLibrary();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const layoutKey = [
    library.handle.key,
    library.epoch,
    size.width,
    size.height,
    prefs.fontSize,
    prefs.lineHeight,
    prefs.serif,
    props.readingMode,
    props.readingLanguage || prefs.language,
    props.chapter.id,
    isPdfBook(props.book),
    props.book.pageDirection,
    props.book.media?.revision,
    props.book.references?.revision,
    props.chapter.paragraphs
      .map((paragraph) => props.translationKeys[paragraph.id] || '')
      .join('|'),
  ].join(':');
  // A committed paragraph changes pagination, but existing native line measurements
  // remain valid at the same geometry. Retain them across incremental page layouts.
  const measurements = useMemo<Measurements>(() => new Map(), [layoutKey]);
  const translations = props.readingMode === 'original' ? noTranslations : props.translations;
  const translated =
    props.readingMode === 'original'
      ? 0
      : props.chapter.paragraphs.filter((paragraph) => translations[paragraph.id]).length;
  const key = `${layoutKey}:${translated}`;
  return (
    <View
      style={{ flex: 1 }}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
      }}
    >
      {size.width > 0 && size.height > 0 && (
        <PageLayout
          key={key}
          {...props}
          translations={translations}
          measurements={measurements}
          width={size.width}
          height={size.height}
        />
      )}
    </View>
  );
}
function PageLayout({
  book,
  chapter,
  translations,
  translationKeys,
  readingMode,
  readingLanguage,
  anchor,
  startAtEnd,
  notes,
  onPosition,
  onReadyChange,
  onPage,
  onTap,
  onSelect,
  onBoundary,
  onImage,
  onReference,
  onReferences,
  width,
  height,
  measurements,
}: Props & { width: number; height: number; measurements: Measurements }) {
  const { colors, preferences: prefs, t } = useApp();
  const library = useLibrary();
  const language = readingLanguage || prefs.language;
  const pdf = isPdfBook(book);
  const horizontal = width > 700 ? Math.max(32, (width - 700) / 2) : 26;
  const textWidth = width - horizontal * 2;
  // Keep this space even on fully translated pages: readiness labels must not
  // become book text or change the page capacity when a missing passage appears.
  const statusHeight = readingMode === 'translation' ? 40 : 0;
  const pageHeight = Math.max(1, height - statusHeight);
  const capacity = Math.max(80, pageHeight - 40);
  const list = useRef<FlatList<Page>>(null);
  const [, setMeasurementRevision] = useState(0);
  const readyCallback = useRef(onReadyChange);
  readyCallback.current = onReadyChange;
  const [pageIndex, setPageIndex] = useState(0);
  const measured = useRef(measurements);
  const restore = useRef(anchor);
  const initialPage = useRef(0);
  const publishedPage = useRef<number | null>(null);
  const restoredPages = useRef<Page[] | null>(null);
  const repairedImages = useRef(new Set<string>());
  const callbacks = useRef({
    onPosition,
    onPage,
    onTap,
    onSelect,
    onBoundary,
    onImage,
    onReference,
    onReferences,
  });
  callbacks.current = {
    onPosition,
    onPage,
    onTap,
    onSelect,
    onBoundary,
    onImage,
    onReference,
    onReferences,
  };
  const references = useMemo(() => referencesByParagraph(book), [book]);
  const images = useMemo(
    () => bookImages(book).filter((image) => image.placement.chapterId === chapter.id),
    [book, chapter.id],
  );
  const imageAssets = useMemo(
    () => [...new Map(images.map(({ asset }) => [asset.id, asset])).values()],
    [images],
  );
  const imageFiles = useBookImageFiles(library, imageAssets);
  const imageGroups = useMemo(() => {
    const groups = new Map<string, { before: BookImageReference[]; after: BookImageReference[] }>();
    for (const image of images) {
      const group = groups.get(image.placement.paragraphId) || { before: [], after: [] };
      group[image.placement.position].push(image);
      groups.set(image.placement.paragraphId, group);
    }
    return groups;
  }, [images]);
  const runs = useMemo(() => {
    const body: TextStyle = {
      fontSize: prefs.fontSize,
      lineHeight: prefs.fontSize * prefs.lineHeight,
      fontFamily: prefs.serif ? 'Georgia' : undefined,
      textAlign: book.pageDirection === 'rtl' ? 'right' : 'left',
      writingDirection: book.pageDirection === 'rtl' ? 'rtl' : 'auto',
    };
    const headingSize = Math.max(26, prefs.fontSize + 8);
    const items: Run[] = [];
    const first = chapter.paragraphs[0];
    // PDF chapters are physical pages, so their synthetic labels belong in the
    // reader chrome. Keep real source headings/IDs for reading and annotations.
    if (!pdf && (first?.kind !== 'heading' || first.text.trim() !== chapter.title.trim()))
      items.push({
        key: 'chapter-heading',
        text: chapter.title,
        source: 'original',
        lineHeight: headingSize * 1.3,
        style: { ...body, fontSize: headingSize, lineHeight: headingSize * 1.3 },
      });
    for (const paragraph of chapter.paragraphs) {
      const addImages = (position: 'before' | 'after') => {
        for (const image of imageGroups.get(paragraph.id)?.[position] || [])
          items.push({
            key: image.placement.id,
            paragraph,
            source: 'original',
            text: '',
            style: {},
            lineHeight: 0,
            image,
          });
      };
      addImages('before');
      const translated = translations[paragraph.id];
      if (readingMode !== 'translation' || !translated) {
        const fontSize = prefs.fontSize + (paragraph.kind === 'heading' ? 3 : 0);
        const style: TextStyle = {
          ...body,
          fontSize,
          lineHeight: fontSize * prefs.lineHeight,
          fontFamily: paragraph.kind === 'code' ? 'Menlo' : body.fontFamily,
          fontStyle: paragraph.kind === 'quote' ? 'italic' : 'normal',
          fontWeight: paragraph.kind === 'heading' ? '600' : '400',
        };
        items.push({
          key: paragraph.id + ':original',
          paragraph,
          source: 'original',
          text: paragraph.text,
          style,
          lineHeight: fontSize * prefs.lineHeight,
        });
      }
      if (readingMode !== 'original' && translated) {
        const fontSize = readingMode === 'bilingual' ? prefs.fontSize - 2 : prefs.fontSize;
        items.push({
          key: paragraph.id + ':translation',
          paragraph,
          source: 'translation',
          text: translated,
          lineHeight: fontSize * prefs.lineHeight,
          style: {
            ...body,
            fontFamily: undefined,
            fontSize,
            lineHeight: fontSize * prefs.lineHeight,
            writingDirection: 'auto',
          },
        });
      }
      addImages('after');
    }
    return items;
  }, [
    pdf,
    book.pageDirection,
    chapter,
    translations,
    prefs.fontSize,
    prefs.lineHeight,
    prefs.serif,
    readingMode,
    imageGroups,
  ]);
  const measurementRuns = runs.filter(
    (run) => !run.image && measured.current.get(run.key)?.text !== run.text,
  );
  const ready = measurementRuns.length === 0;
  const batchRuns = measurementRuns.slice(0, 24);
  function capture(run: Run, event: NativeSyntheticEvent<TextLayoutEventData>) {
    if (measured.current.get(run.key)?.text === run.text) return;
    let cursor = 0;
    const lines = event.nativeEvent.lines.map((line) => {
      const content = line.text;
      const located = run.text.indexOf(content, cursor);
      const from = located >= cursor ? located : cursor;
      const end = Math.min(run.text.length, from + content.length);
      cursor = end;
      return { text: content, start: from, end };
    });
    if (!lines.length) lines.push({ text: run.text, start: 0, end: run.text.length });
    measured.current.set(run.key, { text: run.text, lines });
    if (batchRuns.every((item) => measured.current.get(item.key)?.text === item.text))
      setMeasurementRevision((old) => old + 1);
  }
  const pages = useMemo(() => {
    if (!ready) return [];
    const result: Page[] = [];
    let fragments: Fragment[] = [];
    let used = 0;
    const commit = () => {
      if (fragments.length) {
        result.push({ fragments });
        fragments = [];
        used = 0;
      }
    };
    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const run = runs[runIndex];
      const paragraph = run.paragraph;
      const nearbyImages = paragraph ? imageGroups.get(paragraph.id) : undefined;
      if (
        paragraph?.kind === 'heading' &&
        paragraph.text.length < 240 &&
        (nearbyImages?.before.length || 0) + (nearbyImages?.after.length || 0) === 1 &&
        runs[runIndex - 1]?.paragraph?.id !== paragraph.id
      ) {
        let end = runIndex + 1;
        while (runs[end]?.paragraph?.id === paragraph.id) end++;
        const group = runs.slice(runIndex, end);
        const illustration = group.find((item) => item.image)?.image;
        const captionHeight = group.reduce(
          (total, item) =>
            total +
            (item.image
              ? 0
              : (measured.current.get(item.key)?.lines.length || 0) * item.lineHeight),
          0,
        );
        const between = 12;
        const imageRoom = capacity - captionHeight - between * (group.length - 1);
        const naturalHeight = illustration
          ? bookImageSize(illustration.asset, textWidth).height
          : 0;
        // A caption that nearly fills the whole page still uses normal text flow.
        // Otherwise reserve the caption before fitting its single complete image.
        if (illustration && imageRoom >= Math.min(48, naturalHeight)) {
          const imageHeight = bookImageSize(illustration.asset, textWidth, imageRoom).height;
          const groupHeight = captionHeight + between * (group.length - 1) + imageHeight;
          if (fragments.length && used + groupHeight > capacity) commit();
          for (let index = 0; index < group.length; index++) {
            const item = group[index];
            const lines = measured.current.get(item.key)?.lines || [];
            const at =
              item.image?.placement.position === 'after'
                ? Math.max(0, paragraph.text.length - 1)
                : 0;
            const start = item.image ? at : lines[0]?.start || 0;
            const end = item.image ? at : lines.at(-1)?.end || item.text.length;
            const height = item.image ? imageHeight : lines.length * item.lineHeight;
            const gap = index === group.length - 1 ? 18 : between;
            fragments.push({
              run: item,
              text: item.image ? '' : item.text.slice(start, end),
              start,
              end,
              height,
              gap,
            });
            used += height + gap;
          }
          runIndex = end - 1;
          if (used >= capacity) commit();
          continue;
        }
      }
      if (run.image) {
        const imageHeight = bookImageSize(run.image.asset, textWidth, capacity).height;
        if (fragments.length && used + imageHeight > capacity) commit();
        const at =
          run.image.placement.position === 'after'
            ? Math.max(0, (run.paragraph?.text.length || 1) - 1)
            : 0;
        fragments.push({ run, text: '', start: at, end: at, height: imageHeight, gap: 18 });
        used += imageHeight + 18;
        if (used >= capacity) commit();
        continue;
      }
      const lines = measured.current.get(run.key)?.lines || [];
      let index = 0;
      while (index < lines.length) {
        let fit = Math.floor((capacity - used) / run.lineHeight);
        if (fit < 1 && fragments.length) {
          commit();
          fit = Math.floor(capacity / run.lineHeight);
        }
        fit = Math.max(1, Math.min(fit, lines.length - index));
        const slice = lines.slice(index, index + fit);
        const gap = index + fit === lines.length ? (run.paragraph ? 18 : 26) : 0;
        fragments.push({
          run,
          text: run.text.slice(slice[0].start, slice[slice.length - 1].end),
          start: slice[0].start,
          end: slice[slice.length - 1].end,
          height: fit * run.lineHeight,
          gap,
        });
        used += fit * run.lineHeight + gap;
        index += fit;
        if (index < lines.length) commit();
      }
    }
    commit();
    return result;
  }, [ready, runs, capacity, textWidth, imageGroups]);
  const visibleReferences = useMemo(() => {
    const values = new Map<string, ReadingReference>();
    for (const fragment of pages[pageIndex]?.fragments || []) {
      const paragraph = fragment.run.paragraph;
      if (!paragraph || fragment.run.image) continue;
      for (const link of references.get(paragraph.id) || []) {
        if (
          fragment.run.source === 'original' &&
          (link.start >= fragment.end || link.end <= fragment.start)
        )
          continue;
        const key = `${link.id}:${paragraph.id}`;
        if (!values.has(key))
          values.set(key, {
            id: link.id,
            label: link.label,
            origin: {
              paragraph: paragraph.id,
              textOffset:
                fragment.run.source === 'original'
                  ? Math.max(fragment.start, link.start)
                  : fragment.start,
              textSource: fragment.run.source,
            },
          });
      }
    }
    return [...values.values()];
  }, [pages, pageIndex, references]);
  useEffect(() => callbacks.current.onReferences(visibleReferences), [visibleReferences]);
  const publish = (
    index: number,
    exact?: { paragraph: string; textOffset: number; textSource: Source },
  ) => {
    const page = pages[index];
    if (!page) return;
    setPageIndex(index);
    callbacks.current.onPage(index + 1, pages.length);
    // UIKit/FlatList may report the same page again after restoration or an effect change.
    // Only an actual page turn should replace an exact search/note/citation anchor.
    if (!exact && publishedPage.current === index) return;
    publishedPage.current = index;
    const fragment =
      page.fragments.find((f) => f.run.paragraph && !f.run.image) ||
      page.fragments.find((f) => f.run.paragraph);
    const next =
      exact ||
      (fragment?.run.paragraph
        ? {
            paragraph: fragment.run.paragraph.id,
            textOffset: fragment.start,
            textSource: fragment.run.source,
          }
        : null);
    if (next) {
      restore.current = { ...restore.current, ...next };
      callbacks.current.onPosition(next.paragraph, next.textOffset, next.textSource);
    }
  };
  useEffect(() => {
    if (!pages.length || !imageFiles.ready || restoredPages.current === pages) return;
    restoredPages.current = pages;
    const target = restore.current;
    let found = -1;
    let exact: { paragraph: string; textOffset: number; textSource: Source } | undefined;
    for (let index = 0; index < pages.length; index++) {
      for (const fragment of pages[index].fragments) {
        if (
          fragment.run.image ||
          fragment.run.paragraph?.id !== target.paragraph ||
          (target.textSource && fragment.run.source !== target.textSource)
        )
          continue;
        const offset = Math.max(0, Math.min(target.textOffset || 0, fragment.run.text.length - 1));
        if (fragment.start <= offset && fragment.end > offset) {
          found = index;
          exact = {
            paragraph: target.paragraph,
            textOffset: offset,
            textSource: fragment.run.source,
          };
          break;
        }
      }
      if (found >= 0) break;
    }
    if (found < 0) {
      found = pages.findIndex((page) =>
        page.fragments.some((f) => !f.run.image && f.run.paragraph?.id === target.paragraph),
      );
      const fragment = pages[found]?.fragments.find(
        (f) => !f.run.image && f.run.paragraph?.id === target.paragraph,
      );
      if (fragment?.run.paragraph)
        exact = {
          paragraph: fragment.run.paragraph.id,
          textOffset: fragment.start,
          textSource: fragment.run.source,
        };
    }
    // Chapter entry includes leading illustrations; backward chapter navigation
    // includes trailing illustrations. Stored positions still reference adjacent text.
    if (startAtEnd) {
      found = pages.length - 1;
      exact = undefined;
    } else if (
      target.paragraph === chapter.paragraphs[0]?.id &&
      !target.textOffset &&
      target.textSource !== 'translation'
    ) {
      found = 0;
    }
    initialPage.current = Math.max(0, found);
    publish(initialPage.current, exact);
    // Native layout is available on the next frame; the stable item geometry avoids scroll retries.
    const frame = requestAnimationFrame(() =>
      list.current?.scrollToOffset({ offset: initialPage.current * width, animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [pages, width, imageFiles.ready]);
  function turn(direction: -1 | 1) {
    const target = pageIndex + direction;
    if (target < 0 || target >= pages.length) {
      callbacks.current.onBoundary(direction);
      return;
    }
    list.current?.scrollToIndex({ index: target, animated: prefs.pageEffect !== 'none' });
    publish(target);
  }
  function tap(x: number) {
    if (x < width * 0.22) turn(book.pageDirection === 'rtl' ? 1 : -1);
    else if (x > width * 0.78) turn(book.pageDirection === 'rtl' ? -1 : 1);
    else callbacks.current.onTap();
  }
  const nativePages = useMemo(
    () =>
      JSON.stringify(
        pages.slice(Math.max(0, pageIndex - 2), pageIndex + 3).map((page, offset) => ({
          index: Math.max(0, pageIndex - 2) + offset,
          background: colors.background,
          highlight: colors.highlight,
          horizontal,
          rtl: book.pageDirection === 'rtl',
          referenceColor: colors.accent,
          fragments: page.fragments.map((fragment) => ({
            ...(fragment.run.image
              ? {
                  image: {
                    placementId: fragment.run.image.placement.id,
                    uri: imageFiles.uris[fragment.run.image.asset.id],
                    displayWidth: bookImageSize(
                      fragment.run.image.asset,
                      textWidth,
                      fragment.height,
                    ).width,
                    label: fragment.run.image.placement.alt || t('bookImage'),
                    hint: t('openBookImage'),
                    errorLabel: t('bookImageError'),
                  },
                }
              : {}),
            text: fragment.text,
            paragraph: fragment.run.paragraph?.id,
            source: fragment.run.source,
            start: fragment.start,
            end: fragment.end,
            height: fragment.height,
            gap: fragment.gap,
            fontSize: fragment.run.style.fontSize || prefs.fontSize,
            lineHeight: fragment.run.lineHeight,
            fontFamily: fragment.run.style.fontFamily,
            bold: fragment.run.style.fontWeight === '600',
            italic: fragment.run.style.fontStyle === 'italic',
            color:
              fragment.run.source === 'translation' && readingMode === 'bilingual'
                ? colors.muted
                : colors.ink,
            highlights:
              fragment.run.paragraph && !fragment.run.image
                ? passageRanges(
                    notes,
                    fragment.run.paragraph.id,
                    fragment.run.text,
                    fragment.run.source,
                    translationKeys[fragment.run.paragraph.id],
                  )
                    .map(({ start, end }) => ({
                      start: Math.max(0, start - fragment.start),
                      end: Math.min(fragment.text.length, end - fragment.start),
                    }))
                    .filter(({ start, end }) => end > start)
                : [],
            links:
              nativeReaderSupportsReferences &&
              fragment.run.source === 'original' &&
              fragment.run.paragraph &&
              !fragment.run.image
                ? (references.get(fragment.run.paragraph.id) || [])
                    .map((link) => ({
                      id: link.id,
                      start: Math.max(0, link.start - fragment.start),
                      end: Math.min(fragment.text.length, link.end - fragment.start),
                      label: t('bookReferenceOpen', { label: link.label }),
                    }))
                    .filter((link) => link.end > link.start)
                : [],
          })),
        })),
      ),
    [
      pages,
      pageIndex,
      colors,
      horizontal,
      book.pageDirection,
      notes,
      language,
      prefs.fontSize,
      readingMode,
      imageFiles.uris,
      t,
      references,
    ],
  );
  const chapterIndex = book.chapters.findIndex((item) => item.id === chapter.id);
  const contentReady = ready && imageFiles.ready;
  const needsNativeUpdate = !!NativePageView && !!images.length && !nativeReaderSupportsImages;
  const hasMissingTranslation =
    readingMode === 'translation' &&
    contentReady &&
    pages[pageIndex]?.fragments.some(
      ({ run }) =>
        !run.image && run.paragraph && run.source === 'original' && !translations[run.paragraph.id],
    );
  useEffect(() => {
    readyCallback.current?.(contentReady && !needsNativeUpdate && pages.length > 0);
    return () => readyCallback.current?.(false);
  }, [contentReady, needsNativeUpdate, pages.length]);
  return (
    <View style={{ flex: 1 }}>
      {(!contentReady || needsNativeUpdate) && (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
          {!imageFiles.error && !needsNativeUpdate && <ActivityIndicator color={colors.accent} />}
          <Text
            style={{ fontSize: 12, color: colors.muted, paddingHorizontal: 24, lineHeight: 22 }}
          >
            {t(
              needsNativeUpdate
                ? 'bookImagesNeedUpdate'
                : imageFiles.error
                  ? 'bookImageError'
                  : 'layingOut',
            )}
          </Text>
          {(imageFiles.error || needsNativeUpdate) && (
            <Pressable
              onPress={needsNativeUpdate ? onTap : imageFiles.retry}
              style={{ padding: 14 }}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.accent }}>
                {t(needsNativeUpdate ? 'more' : 'retry')}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {!ready && (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: horizontal, width: textWidth, opacity: 0 }}
        >
          {batchRuns.map((run) => (
            <Text
              key={run.key}
              allowFontScaling={false}
              onTextLayout={(event) => capture(run, event)}
              style={[run.style, { width: textWidth, position: 'absolute', top: 0 }]}
            >
              {run.text}
            </Text>
          ))}
        </View>
      )}
      {contentReady && !needsNativeUpdate && NativePageView && (
        <NativePageView
          style={{ flex: 1 }}
          pagesJSON={nativePages}
          pageIndex={pageIndex}
          totalPages={pages.length}
          effect={prefs.pageEffect}
          hasPrevious={chapterIndex > 0}
          hasNext={chapterIndex < book.chapters.length - 1}
          onPageChange={({ nativeEvent }) => publish(nativeEvent.index)}
          onCenterTap={() => callbacks.current.onTap()}
          onBoundary={({ nativeEvent }) => callbacks.current.onBoundary(nativeEvent.direction)}
          onImagePress={({ nativeEvent }) => {
            const image = images.find((entry) => entry.placement.id === nativeEvent.placementId);
            if (image) callbacks.current.onImage(image);
          }}
          onImageError={({ nativeEvent }) => {
            const image = images.find((entry) => entry.placement.id === nativeEvent.placementId);
            if (!image || repairedImages.current.has(image.asset.id)) return;
            repairedImages.current.add(image.asset.id);
            imageFiles.repair(image.asset.id);
          }}
          {...(nativeReaderSupportsReferences
            ? {
                onReferencePress: ({
                  nativeEvent,
                }: {
                  nativeEvent: { id: string; paragraph: string; start: number };
                }) => {
                  callbacks.current.onReference(nativeEvent.id, {
                    paragraph: nativeEvent.paragraph,
                    textOffset: nativeEvent.start,
                    textSource: 'original',
                  });
                },
              }
            : {})}
          onSelect={({ nativeEvent }) => {
            const paragraph = chapter.paragraphs.find((item) => item.id === nativeEvent.paragraph);
            if (!paragraph) return;
            callbacks.current.onSelect({
              paragraph,
              source: nativeEvent.source,
              text:
                nativeEvent.source === 'translation'
                  ? translations[paragraph.id] || paragraph.text
                  : paragraph.text,
              start: nativeEvent.start,
              end: nativeEvent.end,
              language: language,
              ...(nativeEvent.source === 'translation'
                ? { translationKey: translationKeys[paragraph.id] }
                : {}),
            });
          }}
        />
      )}
      {contentReady && !NativePageView && (
        <FlatList
          ref={list}
          data={pages}
          horizontal
          pagingEnabled
          inverted={book.pageDirection === 'rtl'}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={5}
          keyExtractor={(_, i) => String(i)}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onScrollEndDrag={(event) => {
            const offset = event.nativeEvent.contentOffset.x;
            if (offset < -45) callbacks.current.onBoundary(-1);
            else if (offset > Math.max(0, pages.length - 1) * width + 45)
              callbacks.current.onBoundary(1);
          }}
          onMomentumScrollEnd={(event) =>
            publish(
              Math.max(
                0,
                Math.min(pages.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)),
              ),
            )
          }
          renderItem={({ item }) => (
            <Pressable
              accessible={false}
              onPress={(event) => tap(event.nativeEvent.locationX)}
              style={{
                width,
                height: pageHeight,
                paddingHorizontal: horizontal,
                paddingTop: 16,
                paddingBottom: 24,
              }}
            >
              {item.fragments.map((fragment, index) =>
                fragment.run.image ? (
                  <View
                    key={fragment.run.key}
                    style={{ height: fragment.height, marginBottom: fragment.gap }}
                  >
                    <BookImage
                      image={fragment.run.image}
                      height={fragment.height}
                      open={(image) => callbacks.current.onImage(image)}
                    />
                  </View>
                ) : (
                  <Pressable
                    key={fragment.run.key + ':' + index}
                    accessibilityRole="button"
                    accessibilityLabel={fragment.text}
                    onPress={(event) => tap(event.nativeEvent.pageX)}
                    onLongPress={() => {
                      if (fragment.run.paragraph)
                        callbacks.current.onSelect({
                          paragraph: fragment.run.paragraph,
                          source: fragment.run.source,
                          text: fragment.run.text,
                          start: fragment.start,
                          end: fragment.end,
                          language: language,
                          ...(fragment.run.source === 'translation'
                            ? { translationKey: translationKeys[fragment.run.paragraph.id] }
                            : {}),
                        });
                    }}
                    accessibilityHint={fragment.run.paragraph ? t('noteHint') : undefined}
                    style={{
                      height: fragment.height,
                      marginBottom: fragment.gap,
                      borderRadius: 3,
                    }}
                  >
                    <Text
                      allowFontScaling={false}
                      style={[
                        fragment.run.style,
                        {
                          color:
                            fragment.run.source === 'translation' && readingMode === 'bilingual'
                              ? colors.muted
                              : colors.ink,
                        },
                      ]}
                    >
                      <HighlightedPassage
                        text={fragment.text}
                        offset={fragment.start}
                        links={
                          fragment.run.source === 'original' && fragment.run.paragraph
                            ? references.get(fragment.run.paragraph.id)
                            : undefined
                        }
                        onLink={(link) => {
                          if (fragment.run.paragraph)
                            callbacks.current.onReference(link.id, {
                              paragraph: fragment.run.paragraph.id,
                              textOffset: Math.max(link.start, fragment.start),
                              textSource: 'original',
                            });
                        }}
                        onLinkLongPress={() => {
                          if (fragment.run.paragraph)
                            callbacks.current.onSelect({
                              paragraph: fragment.run.paragraph,
                              source: fragment.run.source,
                              text: fragment.run.text,
                              start: fragment.start,
                              end: fragment.end,
                              language: language,
                              ...(fragment.run.source === 'translation'
                                ? { translationKey: translationKeys[fragment.run.paragraph.id] }
                                : {}),
                            });
                        }}
                        ranges={
                          fragment.run.paragraph
                            ? passageRanges(
                                notes,
                                fragment.run.paragraph.id,
                                fragment.run.text,
                                fragment.run.source,
                                translationKeys[fragment.run.paragraph.id],
                              )
                            : []
                        }
                      />
                    </Text>
                  </Pressable>
                ),
              )}
            </Pressable>
          )}
        />
      )}
      {statusHeight > 0 && (
        <View
          style={{
            height: statusHeight,
            justifyContent: 'center',
            paddingHorizontal: horizontal,
          }}
        >
          {hasMissingTranslation && (
            <Text
              accessibilityLiveRegion="polite"
              numberOfLines={2}
              style={{ color: colors.muted, fontSize: 11, lineHeight: 14 }}
            >
              {t('translationMissing')}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
