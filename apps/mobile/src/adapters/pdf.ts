import { requireOptionalNativeModule } from 'expo-modules-core';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { measured } from './diagnostics';
import {
  PDF_LIMITS,
  PdfParseInterruption,
  pdfToBook,
  type ParsedPdf,
  type PdfImportReport,
} from '@bypage/reading-core';
import { assertLibraryHandle, type LibraryHandle } from './library-scope';
export type { PdfTextEvidence } from '@bypage/reading-core';

type NativePdf = {
  removeAccountOriginals?: (scope: string) => Promise<void>;
  originalViewVersion?: number;
  navigationVersion?: number;
  thumbnailsVersion?: number;
  searchVersion?: number;
  searchEvidenceVersion?: number;
  scopedOriginalVersion?: number;
  resumableExtractionVersion?: number;
  extractResumable?: (
    uri: string,
    password: string | null,
    from: number,
    to: number,
    ocr: boolean,
    sessionId: string,
    job: string,
  ) => Promise<NativeExtractionResult>;
  closeExtraction?: (sessionId: string) => Promise<void>;
  retainOriginalInScope?: (
    scope: string,
    bookId: string,
    uri: string,
  ) => Promise<RetainedPdfOriginal>;
  getOriginalInScope?: (scope: string, bookId: string) => Promise<PdfOriginal | null>;
  removeOriginalInScope?: (scope: string, bookId: string) => Promise<void>;
  retainOriginal?: (bookId: string, uri: string) => Promise<RetainedPdfOriginal>;
  getOriginal?: (bookId: string) => Promise<PdfOriginal | null>;
  removeOriginal?: (bookId: string) => Promise<void>;
  inspect: (
    uri: string,
    password: string | null,
  ) => Promise<{ totalPages: number; title: string; author: string }>;
  extract: (
    uri: string,
    password: string | null,
    from: number,
    to: number,
    ocr: boolean,
    job: string,
  ) => Promise<ParsedPdf>;
  cancel: (job: string) => void;
  addListener: (
    event: 'onProgress',
    listener: (event: { job: string; page: number; total: number }) => void,
  ) => { remove: () => void };
};
const native = requireOptionalNativeModule<NativePdf>('ByPagePdf');
export const pdfAvailable = !!native;
export type PdfOriginal = { uri: string; size: number };
export type RetainedPdfOriginal = PdfOriginal & { created: boolean };
export const pdfOriginalAvailable =
  !!native &&
  (native.originalViewVersion || 0) >= 1 &&
  !!native.retainOriginal &&
  !!native.getOriginal &&
  !!native.removeOriginal;
export const pdfNavigationAvailable = pdfOriginalAvailable && (native?.navigationVersion || 0) >= 1;
export const pdfThumbnailsAvailable =
  pdfNavigationAvailable && (native?.thumbnailsVersion || 0) >= 1;
export const pdfSearchAvailable = pdfNavigationAvailable && (native?.searchVersion || 0) >= 1;
export const pdfSearchEvidenceAvailable =
  pdfSearchAvailable && (native?.searchEvidenceVersion || 0) >= 1;
export const pdfScopedOriginalAvailable =
  pdfOriginalAvailable &&
  (native?.scopedOriginalVersion || 0) >= 1 &&
  !!native?.retainOriginalInScope &&
  !!native?.getOriginalInScope &&
  !!native?.removeOriginalInScope;

function originalScope(handle: LibraryHandle) {
  assertLibraryHandle(handle);
  if (handle.kind === 'device') return 'device';
  if (!/^account-[a-f0-9]{64}$/.test(handle.attachmentScope)) throw new Error('PDF_LIBRARY_SCOPE');
  if (!pdfScopedOriginalAvailable) throw new Error('PDF_MODULE_UNAVAILABLE');
  return handle.attachmentScope;
}

/** Original bytes stay in app-private storage and are excluded from system backups. */
export async function retainPdfOriginal(
  handle: LibraryHandle,
  bookId: string,
  uri: string,
): Promise<RetainedPdfOriginal> {
  const scope = originalScope(handle);
  if (!pdfOriginalAvailable) throw new Error('PDF_MODULE_UNAVAILABLE');
  if (pdfScopedOriginalAvailable) return native!.retainOriginalInScope!(scope, bookId, uri);
  return native!.retainOriginal!(bookId, uri);
}
export async function getPdfOriginal(
  handle: LibraryHandle,
  bookId: string,
): Promise<PdfOriginal | null> {
  const scope = originalScope(handle);
  if (!pdfOriginalAvailable) throw new Error('PDF_MODULE_UNAVAILABLE');
  if (pdfScopedOriginalAvailable) return native!.getOriginalInScope!(scope, bookId);
  return native!.getOriginal!(bookId);
}
export async function removePdfOriginal(handle: LibraryHandle, bookId: string): Promise<void> {
  const scope = originalScope(handle);
  if (!pdfOriginalAvailable) return;
  if (pdfScopedOriginalAvailable) return native!.removeOriginalInScope!(scope, bookId);
  await native!.removeOriginal!(bookId);
}
export async function inspectPdf(uri: string, password?: string) {
  if (!native) throw new Error('PDF_MODULE_UNAVAILABLE');
  return native.inspect(uri, password || null);
}
type NativeExtractionResult = {
  status: 'complete' | 'paused' | 'failed';
  completed: number;
  total: number;
  sourcePage?: number;
  errorCode?: 'PDF_PAGE_FAILED' | 'PDF_TEXT_LIMIT';
  document?: ParsedPdf;
};
export type PdfParseOptions = {
  uri: string;
  name: string;
  password?: string;
  from: number;
  to: number;
  ocr: boolean;
  pageTitle: (n: number) => string;
  unknownAuthor: string;
};
export type PdfParseSession = {
  readonly resumable: boolean;
  run: (onProgress: (page: number, total: number) => void) => Promise<PdfImportReport>;
  pause: () => void;
  close: () => Promise<void>;
};

// A new import waits for explicitly closing sessions only. An unrelated paused
// import keeps ownership of the native cache and is never silently evicted.
let extractionClosing: Promise<void> = Promise.resolve();

function validExtractionResult(
  value: NativeExtractionResult,
  from: number,
  total: number,
  previous: number,
): NativeExtractionResult {
  if (
    !value ||
    !['complete', 'paused', 'failed'].includes(value.status) ||
    !Number.isSafeInteger(value.completed) ||
    value.completed < previous ||
    value.completed > total ||
    value.total !== total ||
    (value.completed < total
      ? value.sourcePage !== from + value.completed
      : value.sourcePage !== undefined)
  )
    throw new Error('PDF_PARSE_STATE_INVALID');
  if (value.status === 'complete') {
    if (
      value.completed !== total ||
      !value.document ||
      !Array.isArray(value.document.pages) ||
      value.document.pages.length !== total ||
      value.document.pages.some((page, index) => page?.pageNumber !== from + index)
    )
      throw new Error('PDF_PARSE_STATE_INVALID');
  } else if (
    value.status === 'failed' &&
    (value.completed >= total ||
      !['PDF_PAGE_FAILED', 'PDF_TEXT_LIMIT'].includes(value.errorCode || ''))
  )
    throw new Error('PDF_PARSE_STATE_INVALID');
  return value;
}

/** One fixed in-memory import plan. Only successful pages survive pause/retry. */
export function createPdfParseSession(options: PdfParseOptions): PdfParseSession {
  if (!native) throw new Error('PDF_MODULE_UNAVAILABLE');
  const module = native;
  const plan = Object.freeze({ ...options });
  const { uri, password, from, to, ocr } = plan;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 1 ||
    to < from ||
    to > PDF_LIMITS.pages
  )
    throw new Error('PDF_PAGE_RANGE');
  const total = to - from + 1;
  const resumable =
    (module.resumableExtractionVersion || 0) >= 1 &&
    !!module.extractResumable &&
    !!module.closeExtraction;
  const sessionId = Crypto.randomUUID();
  let completed = 0;
  let closed = false;
  let nativeStarted = false;
  let closePromise: Promise<void> | undefined;
  let hashPromise: Promise<string> | undefined;
  let report: PdfImportReport | undefined;
  type Flight = {
    job: string;
    paused: boolean;
    started: boolean;
    result: Promise<PdfImportReport>;
  };
  let flight: Flight | undefined;

  function interrupted(current: Flight) {
    if (closed) throw new Error('PDF_CANCELLED');
    if (current.paused) {
      if (!resumable) throw new Error('PDF_CANCELLED');
      throw new PdfParseInterruption({
        code: 'PDF_PAUSED',
        completed,
        total,
        ...(completed < total ? { sourcePage: from + completed } : {}),
      });
    }
  }
  function hash() {
    if (!hashPromise) {
      const pending = (async () => {
        const file = new File(uri);
        if (!file.exists || !file.size) throw new Error('PDF_INVALID');
        if (file.size > PDF_LIMITS.bytes) throw new Error('PDF_FILE_LIMIT');
        const bytes = await file.bytes();
        // File bytes are temporary and are not retained by the cached promise.
        const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      })();
      hashPromise = pending;
      void pending.catch(() => {
        if (hashPromise === pending) hashPromise = undefined;
      });
    }
    return hashPromise;
  }
  async function waitForClosing(current: Flight) {
    for (;;) {
      interrupted(current);
      const waiting = extractionClosing;
      await waiting;
      // In particular, do not await our own close: it is waiting for this run.
      interrupted(current);
      if (waiting === extractionClosing) return;
    }
  }
  function cancelFlight() {
    if (!flight || flight.paused) return;
    flight.paused = true;
    if (flight.started) module.cancel(flight.job);
  }
  function close() {
    if (closePromise) return closePromise;
    closed = true;
    cancelFlight();
    const running = flight?.result;
    const previousClosing = extractionClosing;
    const closing = (async () => {
      await running?.catch(() => undefined);
      await previousClosing;
      try {
        if (resumable && nativeStarted) await module.closeExtraction!(sessionId);
      } finally {
        hashPromise = undefined;
        report = undefined;
      }
    })();
    closePromise = closing;
    // Keep future imports usable and attach a handler even when a caller closes
    // its UI immediately. Awaiting close still observes its original rejection.
    extractionClosing = closing.catch(() => undefined);
    return closing;
  }
  function run(onProgress: (page: number, total: number) => void) {
    if (closed) return Promise.reject(new Error('PDF_SESSION_CLOSED'));
    if (flight) return Promise.reject(new Error('PDF_BUSY'));
    const current: Flight = {
      job: Crypto.randomUUID(),
      paused: false,
      started: false,
      result: undefined as unknown as Promise<PdfImportReport>,
    };
    flight = current;
    current.result = Promise.resolve()
      .then(() =>
        measured('pdf.parse', async () => {
          let reported = resumable ? completed : 0;
          const listener = module.addListener('onProgress', (event) => {
            if (
              flight === current &&
              !closed &&
              !current.paused &&
              event.job === current.job &&
              event.total === total &&
              Number.isSafeInteger(event.page) &&
              event.page >= reported &&
              event.page <= total
            ) {
              reported = event.page;
              onProgress(event.page, total);
            }
          });
          try {
            interrupted(current);
            if (report) {
              onProgress(total, total);
              return report;
            }
            await waitForClosing(current);
            const id = await hash();
            interrupted(current);
            // Check the barrier in the same continuation that issues native work:
            // a close can begin after an awaited helper itself has resolved.
            for (;;) {
              const waiting = extractionClosing;
              await waiting;
              interrupted(current);
              if (waiting === extractionClosing) break;
            }
            current.started = true;
            nativeStarted = true;
            let document: ParsedPdf;
            if (resumable) {
              const result = validExtractionResult(
                await module.extractResumable!(
                  uri,
                  password || null,
                  from,
                  to,
                  ocr,
                  sessionId,
                  current.job,
                ),
                from,
                total,
                completed,
              );
              completed = result.completed;
              interrupted(current);
              if (result.status !== 'complete') {
                throw new PdfParseInterruption({
                  code: result.status === 'paused' ? 'PDF_PAUSED' : result.errorCode!,
                  completed,
                  total,
                  ...(result.sourcePage !== undefined ? { sourcePage: result.sourcePage } : {}),
                });
              }
              document = result.document!;
            } else {
              // Legacy progress describes work, not durable pages. Any failure
              // remains a regular error; another run starts from the first page.
              document = await module.extract(uri, password || null, from, to, ocr, current.job);
              interrupted(current);
            }
            report = pdfToBook(document, {
              id: `${id}.pdfkit-v3.${from}-${to}.${ocr ? 'ocr' : 'text'}`,
              fileName: plan.name,
              pageTitle: plan.pageTitle,
              unknownAuthor: plan.unknownAuthor,
            });
            return report;
          } catch (error) {
            if (closed || current.paused) interrupted(current);
            throw error;
          } finally {
            current.started = false;
            listener.remove();
          }
        }),
      )
      .finally(() => {
        if (flight === current) flight = undefined;
      });
    return current.result;
  }
  return Object.freeze({ resumable, run, pause: cancelFlight, close });
}

/** Compatibility for callers that still expect a single disposable parse. */
export function parsePdf(
  options: PdfParseOptions & { onProgress: (page: number, total: number) => void },
) {
  const session = createPdfParseSession(options);
  return {
    cancel: () => {
      void session.close();
    },
    result: session.run(options.onProgress).finally(() => session.close()),
  };
}
export function discardPdf(uri: string) {
  const file = new File(uri);
  if (file.uri.startsWith(Paths.cache.uri) && file.exists) {
    try {
      file.delete();
    } catch {
      /* OS cache cleanup */
    }
  }
}

export async function eraseAccountPdfOriginals(handle: LibraryHandle) {
  assertLibraryHandle(handle);
  if (handle.kind !== 'account' || !native?.removeAccountOriginals) throw new Error('PDF_LIBRARY_SCOPE');
  await native.removeAccountOriginals(originalScope(handle));
}
