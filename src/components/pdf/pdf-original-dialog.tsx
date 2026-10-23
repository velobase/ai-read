'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileUp,
  LoaderCircle,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react';
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from 'pdfjs-dist/types/src/display/api';
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport';
import type { PdfTextEvidence } from '../../../packages/reading-core/src';
import { useI18n } from '@/lib/i18n/provider';
import { attachPdfOriginal, readPdfOriginal } from '@/lib/pdf/original';
import {
  searchPdf,
  pdfSearchRects,
  type PdfSearchProgress,
  type PdfSearchMatch,
  type PdfSearchRect,
} from '@/lib/pdf/search';
import type { Book } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function decimalPage(value: string, total: number): number | null {
  const input = value.trim();
  if (!/^[0-9]+$/.test(input)) return null;
  const page = Number(input);
  return Number.isSafeInteger(page) && page >= 1 && page <= total ? page : null;
}
type DrawnPdfPage = {
  document: PDFDocumentProxy;
  page: number;
  width: number;
  height: number;
  viewport: PageViewport;
  requestedWidth: number;
  zoom: number;
};
type SearchState = PdfSearchProgress & {
  document: PDFDocumentProxy;
  query: string;
  attempt: number;
  status: 'searching' | 'done' | 'cancelled' | 'error';
};

/** Renders only local page graphics. No PDF actions, links, scripts or network document URLs. */
export function PdfOriginalDialog({
  book,
  sourcePage,
  close,
  readPage,
}: {
  book: Book;
  sourcePage: number;
  close: () => void;
  readPage: (chapterIndex: number, evidence?: PdfTextEvidence) => void;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<Blob | null>();
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [phase, setPhase] = useState<'loading' | 'missing' | 'password' | 'ready' | 'error'>(
    'loading',
  );
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [unlock, setUnlock] = useState({ password: '', revision: 0 });
  const [page, setPage] = useState(sourcePage);
  const [pageInput, setPageInput] = useState(String(sourcePage));
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [drawnPage, setDrawnPage] = useState<DrawnPdfPage | null>(null);
  const [query, setQuery] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const [activeMatch, setActiveMatch] = useState(-1);
  const [highlight, setHighlight] = useState<{
    drawn: DrawnPdfPage;
    match: PdfSearchMatch;
    query: string;
    attempt: number;
    rects: PdfSearchRect[];
    failed: boolean;
  } | null>(null);
  const searchRun = useRef<AbortController | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const renderedPage = useRef<DrawnPdfPage | null>(null);
  const searchQuery = query.trim();
  const currentSearch =
    phase === 'ready' &&
    searchState?.document === pdf &&
    searchState.query === searchQuery &&
    searchState.attempt === searchAttempt
      ? searchState
      : null;
  const selectedMatch =
    currentSearch?.status !== 'searching' ? currentSearch?.matches[activeMatch] : undefined;
  // Include the requested geometry: an effect has not yet marked the next zoom
  // or page as rendering when its first React frame is committed.
  const canvasReady =
    phase === 'ready' &&
    !rendering &&
    drawnPage?.document === pdf &&
    drawnPage?.page === page &&
    drawnPage.requestedWidth === width &&
    drawnPage.zoom === zoom;
  const currentHighlight =
    canvasReady &&
    highlight?.drawn === drawnPage &&
    highlight.match === selectedMatch &&
    highlight.query === searchQuery &&
    highlight.attempt === searchAttempt
      ? highlight
      : null;
  // Read the latest committed selection, never the match captured by an older
  // button render while query, document, page or geometry is changing.
  const readTarget = useRef({
    ready: canvasReady,
    drawn: drawnPage,
    page,
    search: currentSearch,
    match: selectedMatch,
    readPage,
  });
  readTarget.current = {
    ready: canvasReady,
    drawn: drawnPage,
    page,
    search: currentSearch,
    match: selectedMatch,
    readPage,
  };
  useEffect(() => {
    mounted.current = true;
    let current = true;
    void readPdfOriginal(book.id)
      .then((value) => {
        if (!current) return;
        setFile(value?.file || null);
        if (!value) setPhase('missing');
      })
      .catch(() => {
        if (current) {
          setPhase('error');
          setError(t('无法读取本机 PDF 原件。'));
        }
      });
    return () => {
      current = false;
      mounted.current = false;
    };
  }, [book.id]);
  useEffect(() => {
    if (!file) return;
    let current = true;
    let task: PDFDocumentLoadingTask | undefined;
    setPhase('loading');
    setError('');
    setPdf(null);
    void (async () => {
      const pdfjs = await import('pdfjs-dist');
      const data = new Uint8Array(await file.arrayBuffer());
      if (!current) return;
      pdfjs.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker.min.mjs?v=${pdfjs.version}`;
      task = pdfjs.getDocument({
        data,
        password: unlock.password || undefined,
        useSystemFonts: false,
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
      });
      const document = await task.promise;
      if (!current) return;
      setPdf(document);
      setPage((old) => Math.max(1, Math.min(old, document.numPages)));
      setPassword('');
      setPhase('ready');
    })().catch((reason) => {
      if (!current) return;
      if (reason instanceof Error && reason.name === 'PasswordException') {
        setPhase('password');
        if (unlock.password) setError(t('密码不正确，请重试。'));
      } else {
        setPhase('error');
        setError(t('无法显示 PDF 原页，请重新选择原文件。'));
      }
    });
    return () => {
      current = false;
      void task?.destroy().catch(() => {});
    };
  }, [file, unlock]);
  useEffect(() => {
    setPageInput(String(page));
  }, [page]);
  useEffect(() => {
    setActiveMatch(-1);
    if (!pdf || phase !== 'ready' || !searchQuery) {
      setSearchState(null);
      return;
    }
    let current = true;
    const controller = new AbortController();
    searchRun.current = controller;
    let latest: PdfSearchProgress = {
      matches: [],
      scannedPages: 0,
      totalPages: pdf.numPages,
      textPages: 0,
      limited: false,
    };
    const publish = (status: SearchState['status']) => {
      if (current && searchRun.current === controller)
        setSearchState({
          ...latest,
          document: pdf,
          query: searchQuery,
          attempt: searchAttempt,
          status,
        });
    };
    publish('searching');
    const timer = setTimeout(() => {
      void searchPdf(pdf, searchQuery, {
        signal: controller.signal,
        onProgress(progress) {
          if (!current || controller.signal.aborted) return;
          latest = progress;
          publish('searching');
        },
      }).then(
        (progress) => {
          latest = progress;
          publish(controller.signal.aborted ? 'cancelled' : 'done');
        },
        () => publish(controller.signal.aborted ? 'cancelled' : 'error'),
      );
    }, 220);
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
      if (searchRun.current === controller) searchRun.current = null;
    };
  }, [pdf, phase, searchQuery, searchAttempt]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [phase]);
  useEffect(() => {
    if (!pdf || !width || phase !== 'ready') return;
    let current = true;
    let task: RenderTask | undefined;
    const canvas = document.createElement('canvas');
    const previous = renderedPage.current;
    const area = viewport.current;
    const center =
      previous?.document === pdf && previous.page === page && area
        ? {
            x:
              (area.scrollLeft +
                area.clientWidth / 2 -
                12 -
                Math.max(0, (area.clientWidth - 24 - previous.width) / 2)) /
              previous.width,
            y: (area.scrollTop + area.clientHeight / 2 - 12) / previous.height,
          }
        : null;
    setRendering(true);
    setError('');
    void (async () => {
      const source = await pdf.getPage(page);
      if (!current) return;
      try {
        const base = source.getViewport({ scale: 1 });
        const scale = Math.max(0.1, (width - 24) / base.width) * zoom;
        const display = source.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(12_000_000 / (display.width * display.height)),
        );
        const render = source.getViewport({ scale: scale * ratio });
        canvas.width = Math.ceil(render.width);
        canvas.height = Math.ceil(render.height);
        canvas.style.width = `${display.width}px`;
        canvas.style.height = `${display.height}px`;
        canvas.style.maxWidth = 'none';
        canvas.style.display = 'block';
        canvas.style.margin = '0';
        task = source.render({ canvas, viewport: render, background: '#ffffff' });
        await task.promise;
        if (current && canvasHost.current) {
          const oldCanvas = canvasHost.current.firstElementChild;
          canvasHost.current.replaceChildren(canvas);
          if (oldCanvas instanceof HTMLCanvasElement) oldCanvas.width = 0;
          renderedPage.current = {
            document: pdf,
            page,
            width: display.width,
            height: display.height,
            viewport: display,
            requestedWidth: width,
            zoom,
          };
          setDrawnPage(renderedPage.current);
          if (viewport.current) {
            viewport.current.scrollTop = center
              ? center.y * display.height - viewport.current.clientHeight / 2 + 12
              : 0;
            viewport.current.scrollLeft = center
              ? center.x * display.width -
                viewport.current.clientWidth / 2 +
                12 +
                Math.max(0, (viewport.current.clientWidth - 24 - display.width) / 2)
              : 0;
          }
        }
      } finally {
        source.cleanup();
      }
    })()
      .catch((reason) => {
        if (
          current &&
          !(reason instanceof Error && reason.name === 'RenderingCancelledException')
        ) {
          // Never let the previous canvas impersonate a page that failed to render.
          const oldCanvas = canvasHost.current?.firstElementChild;
          if (oldCanvas instanceof HTMLCanvasElement) oldCanvas.width = 0;
          canvasHost.current?.replaceChildren();
          renderedPage.current = null;
          setDrawnPage(null);
          setError(t('无法显示 PDF 原页，请重新选择原文件。'));
          setPhase('error');
        }
      })
      .finally(() => {
        if (current) setRendering(false);
      });
    return () => {
      current = false;
      task?.cancel();
      // Keep the previous page's geometry until its replacement is ready so
      // browser scroll clamping does not lose the viewport during zoom/reflow.
    };
  }, [pdf, page, width, zoom, phase]);
  useEffect(() => {
    if (!canvasReady || !pdf || !drawnPage || !selectedMatch || selectedMatch.page !== page) return;
    const host = frame.current;
    if (!host) return;
    let current = true;
    const controller = new AbortController();
    void pdfSearchRects(pdf, selectedMatch, drawnPage.viewport, host, controller.signal).then(
      (rects) => {
        if (!current || controller.signal.aborted || renderedPage.current !== drawnPage) return;
        setHighlight({
          drawn: drawnPage,
          match: selectedMatch,
          query: searchQuery,
          attempt: searchAttempt,
          rects,
          failed: false,
        });
        const area = viewport.current;
        const first = rects[0];
        if (area && first) {
          // Scroll only this PDF viewer; never move the reader or modal ancestors.
          area.scrollTop = host.offsetTop + first.top - area.clientHeight / 3;
          area.scrollLeft = host.offsetLeft + first.left + first.width / 2 - area.clientWidth / 2;
        }
      },
      () => {
        if (current && !controller.signal.aborted)
          setHighlight({
            drawn: drawnPage,
            match: selectedMatch,
            query: searchQuery,
            attempt: searchAttempt,
            rects: [],
            failed: true,
          });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [pdf, page, canvasReady, drawnPage, selectedMatch, searchQuery, searchAttempt]);
  async function attach(selected: File) {
    setPhase('loading');
    setError('');
    try {
      const source = await attachPdfOriginal(book, selected);
      if (!mounted.current) return;
      setUnlock({ password: '', revision: 0 });
      setFile(source.file);
    } catch (reason) {
      if (!mounted.current) return;
      setPhase('missing');
      setError(
        t(
          reason instanceof Error && reason.message === 'PDF_SOURCE_MISMATCH'
            ? '文件与这本书不匹配，请选择导入时的同一份 PDF。'
            : '无法保存 PDF 原件，请检查文件和本机存储空间。',
        ),
      );
    }
  }
  const chapterIndex = book.chapters.findIndex((chapter) => chapter.sourcePage === page);
  function selectMatch(direction: -1 | 1) {
    if (!currentSearch || currentSearch.status === 'searching' || !currentSearch.matches.length)
      return;
    const count = currentSearch.matches.length;
    const next =
      activeMatch < 0
        ? direction === 1
          ? 0
          : count - 1
        : (activeMatch + direction + count) % count;
    setActiveMatch(next);
    setPage(currentSearch.matches[next].page);
  }
  function submitPageInput() {
    if (!pdf) return;
    const next = decimalPage(pageInput, pdf.numPages);
    if (next !== null) {
      setActiveMatch(-1);
      setPage(next);
      setPageInput(String(next));
    } else setPageInput(String(page));
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[92dvh] w-[calc(100vw-20px)] max-w-none flex-col gap-3 overflow-hidden rounded-xl p-4 sm:max-w-[1100px]"
      >
        <DialogHeader>
          <DialogTitle className="pe-8">{t('PDF 原页')}</DialogTitle>
        </DialogHeader>
        <p className="truncate text-xs text-muted-foreground">{book.title}</p>
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (selected) void attach(selected);
          }}
        />
        {(phase === 'missing' || phase === 'error') && (
          <div className="m-auto max-w-md space-y-5 p-4 text-center">
            <p className="text-sm leading-7">
              {t('这台设备尚未保存原 PDF。选择同一份文件即可查看原页，不会重新解析或覆盖笔记。')}
            </p>
            <Button onClick={() => picker.current?.click()}>
              <FileUp size={17} />
              {t('选择原 PDF')}
            </Button>
            <p className="text-xs leading-6 text-muted-foreground">
              {t('原 PDF 仅保存在本机，不随书籍同步或阅读包导出。')}
            </p>
          </div>
        )}
        {phase === 'password' && (
          <form
            className="m-auto w-full max-w-sm space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setUnlock((old) => ({ password, revision: old.revision + 1 }));
            }}
          >
            <label className="block space-y-2 text-sm">
              <span>{t('PDF 密码')}</span>
              <Input
                type="password"
                autoComplete="off"
                autoFocus
                maxLength={256}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={!password}>
              {t('解锁 PDF')}
            </Button>
          </form>
        )}
        {phase === 'loading' && (
          <div role="status" className="m-auto flex items-center gap-3 text-sm">
            <LoaderCircle className="animate-spin" size={20} />
            {t('正在读取 PDF…')}
          </div>
        )}
        {phase === 'ready' && pdf && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitPageInput();
                }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={page <= 1}
                  aria-label={t('上一页')}
                  onClick={() => {
                    setActiveMatch(-1);
                    setPage(page - 1);
                  }}
                >
                  <ChevronLeft size={18} />
                </Button>
                <Input
                  aria-label={t('原 PDF 页码')}
                  className="h-9 w-16 text-center"
                  inputMode="numeric"
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value)}
                  onBlur={submitPageInput}
                />
                <span className="px-1 text-xs tabular-nums">/ {pdf.numPages}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={page >= pdf.numPages}
                  aria-label={t('下一页')}
                  onClick={() => {
                    setActiveMatch(-1);
                    setPage(page + 1);
                  }}
                >
                  <ChevronRight size={18} />
                </Button>
              </form>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={zoom <= 0.5}
                  aria-label={t('缩小原页')}
                  onClick={() => setZoom((old) => Math.max(0.5, old - 0.25))}
                >
                  <Minus size={17} />
                </Button>
                <Button variant="ghost" className="h-9 px-2 text-xs" onClick={() => setZoom(1)}>
                  {zoom === 1 ? t('适合宽度') : `${Math.round(zoom * 100)}%`}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={zoom >= 3}
                  aria-label={t('放大原页')}
                  onClick={() => setZoom((old) => Math.min(3, old + 0.25))}
                >
                  <Plus size={17} />
                </Button>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border p-2">
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (currentSearch?.matches.length && currentSearch.status !== 'searching')
                    selectMatch(1);
                  else if (searchQuery) setSearchAttempt((old) => old + 1);
                }}
              >
                <Search className="mx-1 shrink-0 text-muted-foreground" size={16} aria-hidden />
                <Input
                  type="search"
                  aria-label={t('在原 PDF 中查找')}
                  placeholder={t('在原 PDF 中查找')}
                  className="h-9 min-w-0 flex-1"
                  value={query}
                  maxLength={160}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.shiftKey) {
                      event.preventDefault();
                      selectMatch(-1);
                    }
                  }}
                />
                {!!query && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('清除搜索')}
                    onClick={() => setQuery('')}
                  >
                    <X size={16} />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('上一处匹配')}
                  disabled={!currentSearch?.matches.length || currentSearch.status === 'searching'}
                  onClick={() => selectMatch(-1)}
                >
                  <ChevronLeft size={18} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('下一处匹配')}
                  disabled={!currentSearch?.matches.length || currentSearch.status === 'searching'}
                  onClick={() => selectMatch(1)}
                >
                  <ChevronRight size={18} />
                </Button>
              </form>
              {searchQuery && (
                <div className="flex items-start justify-between gap-3">
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-xs leading-5 text-muted-foreground"
                  >
                    {!currentSearch || currentSearch.status === 'searching'
                      ? t('正在查找：{page}/{total} 页，已找到 {count} 处', {
                          page: currentSearch?.scannedPages || 0,
                          total: pdf.numPages,
                          count: currentSearch?.matches.length || 0,
                        })
                      : currentSearch.matches.length
                        ? selectedMatch
                          ? t('第 {current}/{count} 处 · 原页 {page}', {
                              current: activeMatch + 1,
                              count: currentSearch.matches.length,
                              page: selectedMatch.page,
                            })
                          : t('找到 {count} 处匹配，使用箭头定位。', {
                              count: currentSearch.matches.length,
                            })
                        : currentSearch.status === 'done'
                          ? currentSearch.textPages
                            ? t('未找到匹配文字。')
                            : t('此 PDF 没有可搜索的文字层；不会自动进行 OCR。')
                          : null}
                  </p>
                  {currentSearch?.status === 'searching' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => {
                        searchRun.current?.abort();
                        setSearchState((old) =>
                          old === currentSearch ? { ...old, status: 'cancelled' } : old,
                        );
                      }}
                    >
                      {t('停止查找')}
                    </Button>
                  ) : currentSearch && ['error', 'cancelled'].includes(currentSearch.status) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => setSearchAttempt((old) => old + 1)}
                    >
                      {t('重新查找')}
                    </Button>
                  ) : null}
                </div>
              )}
              {currentSearch?.limited && (
                <p className="text-xs text-muted-foreground">
                  {t('仅显示前 {count} 处匹配，请缩小查询范围。', {
                    count: currentSearch.matches.length,
                  })}
                </p>
              )}
              {currentSearch?.status === 'cancelled' && (
                <p className="text-xs text-muted-foreground">
                  {t('查找已停止，已扫描 {page}/{total} 页。', {
                    page: currentSearch.scannedPages,
                    total: currentSearch.totalPages,
                  })}
                </p>
              )}
              {currentSearch?.status === 'error' && (
                <p role="alert" className="text-xs text-destructive">
                  {t('原页查找未能完成，请重试。')}
                </p>
              )}
              {currentHighlight?.failed && (
                <p role="alert" className="text-xs text-destructive">
                  {t('无法定位此处高亮，可重新查找或查看原页。')}
                </p>
              )}
            </div>
            <div
              ref={viewport}
              dir="ltr"
              className="relative min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-3"
              style={{ overflowAnchor: 'none' }}
              tabIndex={0}
              aria-label={t('PDF 第 {n} 页', { n: page })}
            >
              {!canvasReady && (
                <div role="status" className="sticky top-1/2 flex h-0 justify-center">
                  <LoaderCircle className="animate-spin" />
                </div>
              )}
              <div
                ref={frame}
                role="img"
                className="relative mx-auto w-max"
                aria-label={t('PDF 第 {n} 页', { n: page })}
                style={{ visibility: canvasReady ? 'visible' : 'hidden' }}
              >
                <div ref={canvasHost} />
                <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                  {currentHighlight?.rects.map((rect, index) => (
                    <div
                      key={index}
                      className="absolute rounded-[2px] border border-amber-600/70 bg-amber-300/45"
                      style={rect}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                className="shrink-0"
                variant="secondary"
                disabled={chapterIndex < 0 || !canvasReady}
                onClick={() => {
                  const target = readTarget.current;
                  if (!mounted.current || !target.ready || renderedPage.current !== target.drawn)
                    return;
                  const index = book.chapters.findIndex(
                    (chapter) => chapter.sourcePage === target.page,
                  );
                  if (index < 0) return;
                  const evidence =
                    target.search?.document === target.drawn?.document &&
                    target.match?.page === target.page
                      ? target.match.evidence
                      : undefined;
                  target.readPage(index, evidence);
                }}
              >
                {t('阅读此页文字')}
              </Button>
            </div>
            {chapterIndex < 0 && (
              <p className="text-xs text-muted-foreground">{t('此页没有已导入的重排文字。')}</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
