import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Switch, Text, TextInput, View } from 'react-native';
import {
  createPdfImportPreview,
  isPdfParseInterruption,
  type Book,
  type PdfImportReport,
  type PdfParseInterruption,
} from '@bypage/reading-core';
import {
  inspectPdf,
  createPdfParseSession,
  discardPdf,
  retainPdfOriginal,
  removePdfOriginal,
} from '../adapters/pdf';
import { getBook } from '../adapters/database';
import type { LibraryLease } from '../adapters/library-scope';
import { useApp } from '../context';
import { Button, Sheet, styles } from './ui';
import { PdfImportPreview } from './pdf-import-preview';

export function PdfImportSheet({
  file,
  close,
  save,
  visible = true,
  onShow,
  onDismiss,
  onSavingChange,
}: {
  file: { uri: string; name: string; library: LibraryLease };
  close: () => void;
  save: (book: Book, library: LibraryLease) => Promise<void>;
  visible?: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const { colors, t } = useApp();
  const library = file.library;
  const owner = useMemo(() => ({ disposed: false, discarded: false }), [file.uri, library]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [phase, setPhase] = useState<
    | 'opening'
    | 'password'
    | 'range'
    | 'parsing'
    | 'pausing'
    | 'paused'
    | 'interrupted'
    | 'resetting'
    | 'preview'
    | 'saving'
    | 'error'
  >('opening');
  const [metadata, setMetadata] = useState<{
    totalPages: number;
    title: string;
    author: string;
  } | null>(null);
  const [password, setPassword] = useState('');
  const secret = useRef('');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('1');
  const [ocr, setOcr] = useState(false);
  const [title, setTitle] = useState('');
  const [report, setReport] = useState<PdfImportReport | null>(null);
  const previewReport = useRef(report);
  previewReport.current = report;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const [progress, setProgress] = useState({ page: 0, total: 0 });
  const [error, setError] = useState('');
  const job = useRef<ReturnType<typeof createPdfParseSession> | null>(null);
  const running = useRef<ReturnType<typeof createPdfParseSession> | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [interruption, setInterruption] = useState<PdfParseInterruption | null>(null);
  const release = useRef<Promise<void>>(Promise.resolve());
  const inspection = useRef<ReturnType<typeof inspectPdf> | null>(null);
  const alive = useRef(true);
  const request = useRef(0);
  const saving = useRef(false);
  function isCurrent() {
    return (
      alive.current &&
      visibleRef.current &&
      !owner.disposed &&
      currentOwner.current === owner &&
      library.isCurrent()
    );
  }
  function discardPreview() {
    if (owner.discarded) return;
    owner.discarded = true;
    discardPdf(file.uri);
  }
  function releaseSession(current: ReturnType<typeof createPdfParseSession> | null) {
    const closing = current?.close() ?? Promise.resolve();
    const done = Promise.all([release.current, closing, inspection.current?.catch(() => {})]).then(
      () => {},
    );
    // Keep later inspection behind cleanup even after a failed cleanup attempt.
    release.current = done.catch(() => {});
    return done;
  }
  function cancelWork() {
    alive.current = false;
    request.current++;
    secret.current = '';
    const current = job.current;
    job.current = null;
    return releaseSession(current);
  }
  function disposePreview() {
    if (owner.disposed) return;
    owner.disposed = true;
    void cancelWork()
      .catch(() => {})
      .finally(() => {
        // Retain/save still owns the source until confirm's finally settles.
        if (!saving.current) discardPreview();
      });
  }
  function friendly(error: unknown) {
    const code = String(error);
    if (code.includes('PDF_NO_TEXT')) return t('pdfNoText');
    if (code.includes('PDF_COPY_RESTRICTED')) return t('pdfRestricted');
    if (code.includes('LIMIT')) return t('pdfLimit');
    if (code.includes('PDF_MODULE_UNAVAILABLE')) return t('pdfUnavailable');
    return t('pdfError');
  }
  async function inspect(value?: string) {
    if (!isCurrent() || saving.current) return;
    const currentRequest = ++request.current;
    const previous = job.current;
    job.current = null;
    secret.current = '';
    setMetadata(null);
    setReport(null);
    setInterruption(null);
    setFrom('1');
    setPhase('opening');
    setError('');
    try {
      await releaseSession(previous);
      if (!isCurrent() || request.current !== currentRequest) return;
      library.assertCurrent();
      const pending = inspectPdf(file.uri, value);
      inspection.current = pending;
      const info = await pending.finally(() => {
        if (inspection.current === pending) inspection.current = null;
      });
      library.assertCurrent();
      if (!isCurrent() || request.current !== currentRequest) return;
      secret.current = value || '';
      setPassword('');
      setMetadata(info);
      setTitle(
        info.title.trim().slice(0, 2000) ||
          file.name
            .replace(/\.pdf$/i, '')
            .trim()
            .slice(0, 2000) ||
          'PDF',
      );
      setTo(String(info.totalPages));
      setPhase('range');
    } catch (error) {
      if (!isCurrent() || request.current !== currentRequest) return;
      if (String(error).includes('PDF_PASSWORD')) {
        setPhase('password');
        setError(value ? t('pdfPasswordWrong') : '');
      } else {
        setPhase('error');
        setError(friendly(error));
      }
    }
  }
  function finish() {
    if (!isCurrent() || saving.current) return;
    disposePreview();
    if (library.isCurrent()) close();
  }
  useLayoutEffect(() => {
    // A hidden host stays mounted for its native dismissal acknowledgement,
    // but this payload must never restart work or dispose another payload.
    if (!visible || !library.isCurrent()) disposePreview();
  }, [visible, library, owner]);
  useEffect(() => {
    alive.current = !owner.disposed;
    const abort = () => disposePreview();
    library.signal.addEventListener('abort', abort, { once: true });
    if (isCurrent()) void inspect();
    else disposePreview();
    return () => {
      library.signal.removeEventListener('abort', abort);
      // A development effect replay can mount the same preview immediately.
      // Only its owner closing/saving, or a revoked lease, releases the file.
      if (owner.disposed) return;
      if (!library.isCurrent() || !visibleRef.current) disposePreview();
      else void cancelWork().catch(() => {});
    };
  }, [file.uri, library, owner]);
  const valid =
    !!metadata &&
    /^\d+$/.test(from) &&
    /^\d+$/.test(to) &&
    Number(from) >= 1 &&
    Number(to) <= metadata.totalPages &&
    Number(from) <= Number(to);
  async function backToRange() {
    if (!isCurrent() || saving.current || running.current) return;
    const currentRequest = ++request.current;
    const current = job.current;
    job.current = null;
    setReport(null);
    setInterruption(null);
    setPhase('resetting');
    setError('');
    try {
      await releaseSession(current);
    } catch {
      if (isCurrent() && request.current === currentRequest) setError(t('pdfError'));
    }
    if (isCurrent() && request.current === currentRequest) setPhase('range');
  }
  function pause() {
    if (
      !isCurrent() ||
      phaseRef.current !== 'parsing' ||
      !job.current?.resumable ||
      running.current !== job.current
    )
      return;
    phaseRef.current = 'pausing';
    setPhase('pausing');
    job.current.pause();
  }
  async function parse() {
    if (!valid || running.current || !isCurrent() || saving.current) return;
    Keyboard.dismiss();
    const currentRequest = ++request.current;
    setError('');
    setInterruption(null);
    setPhase('parsing');
    if (!job.current || !job.current.resumable)
      setProgress({ page: 0, total: Number(to) - Number(from) + 1 });
    let current = job.current;
    try {
      current ??= createPdfParseSession({
        uri: file.uri,
        name: file.name,
        password: secret.current,
        from: Number(from),
        to: Number(to),
        ocr,
        pageTitle: (n) => t('pdfPage', { n }),
        unknownAuthor: t('unknown'),
      });
      job.current = current;
      running.current = current;
      const result = await current.run((page, total) => {
        if (isCurrent() && request.current === currentRequest) setProgress({ page, total });
      });
      if (isCurrent() && request.current === currentRequest) {
        // Reject a contradictory report before rendering or enabling Save.
        createPdfImportPreview(result);
        setReport(result);
        setPhase('preview');
      }
    } catch (error) {
      if (!isCurrent() || request.current !== currentRequest) return;
      if (isPdfParseInterruption(error)) {
        setProgress({ page: error.completed, total: error.total });
        setInterruption(error);
        if (error.code === 'PDF_PAUSED') setPhase('paused');
        else {
          setError(
            error.code === 'PDF_TEXT_LIMIT'
              ? t('pdfParsePageLimit', { n: error.sourcePage! })
              : t('pdfParsePageFailed', { n: error.sourcePage! }),
          );
          setPhase('interrupted');
        }
      } else {
        setError(friendly(error));
        setPhase('resetting');
        if (job.current === current) job.current = null;
        await releaseSession(current).catch(() => {});
        if (isCurrent() && request.current === currentRequest) setPhase('range');
      }
    } finally {
      if (running.current === current) running.current = null;
    }
  }
  async function confirm() {
    if (!report || saving.current || !isCurrent()) return;
    saving.current = true;
    onSavingChange?.(true);
    Keyboard.dismiss();
    const currentRequest = request.current;
    const book = { ...report.book, title: title.trim() };
    setPhase('saving');
    setError('');
    let retained = false;
    let savedOriginal = false;
    let saved = false;
    try {
      library.assertCurrent();
      const original = await retainPdfOriginal(library.handle, book.id, file.uri);
      retained = original.created;
      savedOriginal = true;
      library.assertCurrent();
      if (!isCurrent() || request.current !== currentRequest) throw new Error('PDF_CANCELLED');
      await save(book, library);
      saved = true;
      library.assertCurrent();
      const current = job.current;
      job.current = null;
      await releaseSession(current).catch(() => {});
    } catch (error) {
      // save may persist the book before a later refresh fails. Remove only a new
      // source whose book is definitely absent, leaving existing associations intact.
      if (retained) {
        try {
          if (!(await getBook(library.handle, book.id)))
            await removePdfOriginal(library.handle, book.id);
        } catch {
          /* Keep the source if the database state cannot be established. */
        }
      }
      if (isCurrent() && request.current === currentRequest) {
        setPhase('preview');
        setError(
          savedOriginal
            ? t('error')
            : String(error).includes('PDF_MODULE_UNAVAILABLE')
              ? t('pdfUnavailable')
              : t('pdfOriginalSaveError'),
        );
      }
    } finally {
      saving.current = false;
      if (saved || !isCurrent()) void release.current.finally(discardPreview);
      onSavingChange?.(false);
    }
  }
  const previewing = (phase === 'preview' || phase === 'saving') && !!report;
  const inputStyle = [styles.input, { color: colors.ink, borderColor: colors.border }];
  return (
    <Sheet
      visible={visible && library.isCurrent()}
      onShow={onShow}
      onDismiss={onDismiss}
      title={t('pdfParse')}
      close={() => {
        if (!saving.current) finish();
      }}
      tall
      scrollable={!previewing}
    >
      {previewing && report ? (
        <View style={{ flex: 1, paddingHorizontal: 22, paddingVertical: 12, gap: 10 }}>
          <View style={{ gap: 8 }}>
            {!keyboardVisible && (
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
                {file.name}
              </Text>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ color: colors.ink, fontSize: 13 }}>{t('sortTitle')}</Text>
              <TextInput
                accessibilityLabel={t('sortTitle')}
                value={title}
                onChangeText={(value) => {
                  if (isCurrent() && !saving.current) setTitle(value);
                }}
                maxLength={2000}
                editable={phase !== 'saving'}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                style={[inputStyle, { flex: 1 }]}
              />
              {keyboardVisible && (
                <Button secondary onPress={Keyboard.dismiss}>
                  {t('done')}
                </Button>
              )}
            </View>
            {!keyboardVisible && (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {t('pdfReady', { n: report.importedPages })}
              </Text>
            )}
            {!!error && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.error, fontSize: 12, lineHeight: 18 }}
              >
                {error}
              </Text>
            )}
          </View>
          <PdfImportPreview
            report={report}
            disabled={phase === 'saving'}
            compact={keyboardVisible}
            isCurrent={() => isCurrent() && !saving.current && previewReport.current === report}
          />
          {!keyboardVisible && (
            <View style={{ gap: 8 }}>
              <Button
                busy={phase === 'saving'}
                disabled={!title.trim()}
                onPress={() => void confirm()}
              >
                {t('importConfirm')}
              </Button>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    disabled={phase === 'saving'}
                    onPress={() => void backToRange()}
                  >
                    {t('pdfRangeAgain')}
                  </Button>
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    disabled={phase === 'saving'}
                    onPress={() => {
                      if (!saving.current) finish();
                    }}
                  >
                    {t('cancel')}
                  </Button>
                </View>
              </View>
            </View>
          )}
        </View>
      ) : (
        <>
          <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 15, fontWeight: '500' }}>
            {file.name}
          </Text>
          {!!error && (
            <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
              {error}
            </Text>
          )}
          {phase === 'password' && (
            <>
              <Text style={{ color: colors.ink }}>{t('pdfPassword')}</Text>
              <TextInput
                secureTextEntry
                autoComplete="off"
                value={password}
                onChangeText={setPassword}
                maxLength={256}
                style={inputStyle}
              />
              <Button disabled={!password} onPress={() => void inspect(password)}>
                {t('pdfUnlock')}
              </Button>
            </>
          )}
          {phase === 'range' && metadata && (
            <>
              <Text style={{ color: colors.muted }}>
                {t('pdfTotal', { n: metadata.totalPages })}
              </Text>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                {[
                  { label: t('pdfFrom'), value: from, set: setFrom },
                  { label: t('pdfTo'), value: to, set: setTo },
                ].map((item) => (
                  <View key={item.label} style={{ flex: 1, gap: 8 }}>
                    <Text style={{ color: colors.ink, fontSize: 13 }}>{item.label}</Text>
                    <TextInput
                      keyboardType="number-pad"
                      value={item.value}
                      onChangeText={item.set}
                      maxLength={4}
                      style={inputStyle}
                    />
                  </View>
                ))}
              </View>
              <View style={styles.spread}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: colors.ink, fontSize: 14 }}>{t('pdfOcr')}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 18 }}>
                    {t('pdfOcrHint')}
                  </Text>
                </View>
                <Switch
                  value={ocr}
                  onValueChange={setOcr}
                  trackColor={{ true: colors.accent }}
                  accessibilityLabel={t('pdfOcr')}
                />
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
                {t('pdfLayoutHint')}
              </Text>
              <Button onPress={() => void parse()} disabled={!valid}>
                {t('pdfStart')}
              </Button>
            </>
          )}
          {['opening', 'parsing', 'pausing', 'resetting'].includes(phase) && (
            <View style={{ paddingVertical: 20, gap: 18 }}>
              <ActivityIndicator color={colors.accent} />
              <Text style={{ color: colors.muted, textAlign: 'center' }}>
                {phase === 'opening'
                  ? t('pdfOpening')
                  : phase === 'resetting'
                    ? t('pdfParseResetting')
                    : phase === 'pausing'
                      ? t('pdfParsePausing')
                      : t('pdfProgress', progress)}
              </Text>
              {(phase === 'parsing' || phase === 'pausing') && (
                <View style={{ height: 4, backgroundColor: colors.border }}>
                  <View
                    style={{
                      height: 4,
                      backgroundColor: colors.accent,
                      width: `${progress.total ? (progress.page / progress.total) * 100 : 0}%`,
                    }}
                  />
                </View>
              )}
              {phase === 'parsing' && job.current?.resumable && (
                <Button secondary onPress={pause}>
                  {t('pdfParsePause')}
                </Button>
              )}
            </View>
          )}
          {(phase === 'paused' || phase === 'interrupted') && (
            <View style={{ gap: 14 }}>
              <Text style={{ color: colors.ink, lineHeight: 23 }}>
                {t(phase === 'paused' ? 'pdfParsePaused' : 'pdfParseCompleted', progress)}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 21 }}>
                {t(job.current?.resumable ? 'pdfParseSessionHint' : 'pdfParseRestartHint')}
              </Text>
              {interruption?.code !== 'PDF_TEXT_LIMIT' && (
                <Button onPress={() => void parse()}>
                  {t(
                    phase === 'paused'
                      ? 'pdfParseContinue'
                      : job.current?.resumable
                        ? 'pdfParseRetryPage'
                        : 'retry',
                  )}
                </Button>
              )}
              <Button secondary onPress={() => void backToRange()}>
                {t('pdfRangeAgain')}
              </Button>
            </View>
          )}
          {phase === 'error' && <Button onPress={() => void inspect()}>{t('retry')}</Button>}
          {phase !== 'saving' && (
            <Button secondary onPress={finish}>
              {t('cancel')}
            </Button>
          )}
        </>
      )}
    </Sheet>
  );
}
