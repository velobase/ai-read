'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { Modal } from '@/components/reader/reader-dialogs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { measureClient } from '@/lib/observability/client';
import { openPdf, type PdfSession } from '@/lib/pdf/parser';
import type { PdfImportReport } from '../../../packages/reading-core/src/pdf-document';
import { createPdfImportPreview } from '../../../packages/reading-core/src/pdf-import-preview';
import {
  PdfParseInterruption,
  isPdfParseInterruption,
} from '../../../packages/reading-core/src/pdf-parse-state';
import type { Book } from '@/lib/types';
import { PdfImportPreview } from './pdf-import-preview';

type Phase =
  | 'opening'
  | 'password'
  | 'range'
  | 'parsing'
  | 'pausing'
  | 'paused'
  | 'interrupted'
  | 'preview'
  | 'saving'
  | 'error';
type ParseRun = {
  session: PdfSession;
  file: File;
  generation: number;
  controller: AbortController;
};

/** Owns the complete local PDF → compatible Book preview. Storage is injected by the host. */
export function PdfImportDialog({
  file,
  close,
  save,
}: {
  file: File;
  close: () => void;
  save: (book: Book) => Promise<void>;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('opening');
  const [session, setSession] = useState<PdfSession | null>(null);
  const [report, setReport] = useState<PdfImportReport | null>(null);
  const [password, setPassword] = useState('');
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('1');
  const [progress, setProgress] = useState({ page: 0, total: 0 });
  const [error, setError] = useState('');
  const [interruption, setInterruption] = useState<PdfParseInterruption | null>(null);
  const opening = useRef<AbortController | null>(null);
  const running = useRef<ParseRun | null>(null);
  const active = useRef<PdfSession | null>(null);
  const mounted = useRef(true);
  const dismissed = useRef(false);
  const generation = useRef(0);
  const currentFile = useRef(file);
  currentFile.current = file;
  const phaseRef = useRef(phase);
  function transition(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }
  function currentRun(run: ParseRun) {
    return (
      mounted.current &&
      !dismissed.current &&
      currentFile.current === run.file &&
      generation.current === run.generation &&
      active.current === run.session &&
      running.current === run
    );
  }
  const preview = useMemo(() => {
    if (!report) return null;
    try {
      return createPdfImportPreview(report);
    } catch {
      return null;
    }
  }, [report]);
  function errorText(error: unknown) {
    const code = error instanceof Error ? error.message : '';
    if (code.includes('PDF_NO_TEXT'))
      return t('没有提取到文字。扫描件需要先进行 OCR；当前网页解析器只读取 PDF 文字层。');
    if (code.includes('PDF_COPY_RESTRICTED')) return t('此 PDF 限制复制文字，无法转换。');
    if (code.includes('LIMIT')) return t('PDF 超出限制：最多 30 MB、1000 页和 20 MB 文字。');
    return t('PDF 解析失败，请检查文件或尝试较小的页码范围。');
  }
  async function load(secret?: string) {
    const token = ++generation.current;
    const loadingFile = file;
    opening.current?.abort();
    running.current?.controller.abort();
    running.current = null;
    const abort = new AbortController();
    opening.current = abort;
    const previous = active.current;
    active.current = null;
    const isCurrent = () =>
      mounted.current &&
      !dismissed.current &&
      currentFile.current === loadingFile &&
      generation.current === token &&
      opening.current === abort &&
      !abort.signal.aborted;
    setSession(null);
    setReport(null);
    setInterruption(null);
    setProgress({ page: 0, total: 0 });
    setPassword('');
    setFrom('1');
    transition('opening');
    setError('');
    try {
      await previous?.close().catch(() => {});
      if (!isCurrent()) return;
      const value = await openPdf(file, { password: secret, signal: abort.signal });
      if (!isCurrent()) {
        await value.close().catch(() => {});
        return;
      }
      active.current = value;
      setSession(value);
      setTitle(value.title);
      setTo(String(value.totalPages));
      transition('range');
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof Error && error.name === 'PasswordException') {
        transition('password');
        setError(secret ? t('密码不正确，请重试。') : '');
      } else {
        setError(errorText(error));
        transition('error');
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    dismissed.current = false;
    void load();
    return () => {
      mounted.current = false;
      generation.current++;
      opening.current?.abort();
      running.current?.controller.abort();
      running.current = null;
      void active.current?.close().catch(() => {});
      active.current = null;
    };
  }, [file]);
  const rangeValid =
    !!session &&
    /^\d+$/.test(from) &&
    /^\d+$/.test(to) &&
    Number(from) >= 1 &&
    Number(to) <= session.totalPages &&
    Number(from) <= Number(to);
  async function parse() {
    if (
      !session ||
      active.current !== session ||
      !rangeValid ||
      dismissed.current ||
      running.current ||
      !['range', 'paused', 'interrupted'].includes(phaseRef.current)
    )
      return;
    const abort = new AbortController();
    const run: ParseRun = {
      session,
      file,
      generation: generation.current,
      controller: abort,
    };
    running.current = run;
    setError('');
    setInterruption(null);
    setReport(null);
    transition('parsing');
    setProgress({ page: 0, total: Number(to) - Number(from) + 1 });
    const finish = measureClient('pdf_parse', { format: 'pdf' });
    try {
      const result = await session.parse({
        from: Number(from),
        to: Number(to),
        unknownAuthor: t('未知作者'),
        pageTitle: (n) => t('PDF 第 {n} 页', { n }),
        signal: abort.signal,
        onProgress: (page, total) => {
          if (currentRun(run) && !abort.signal.aborted) setProgress({ page, total });
        },
      });
      if (!currentRun(run)) {
        finish('cancelled');
        return;
      }
      if (abort.signal.aborted)
        throw new PdfParseInterruption({
          code: 'PDF_PAUSED',
          completed: Number(to) - Number(from) + 1,
          total: Number(to) - Number(from) + 1,
        });
      setReport(result);
      transition('preview');
      finish('ok', { count: result.importedPages });
    } catch (error) {
      finish(!currentRun(run) || abort.signal.aborted ? 'cancelled' : 'error');
      if (!currentRun(run)) return;
      if (isPdfParseInterruption(error)) {
        setInterruption(error);
        setProgress({ page: error.completed, total: error.total });
        if (error.code === 'PDF_PAUSED') {
          transition('paused');
        } else {
          transition('interrupted');
          setError(
            t(
              error.code === 'PDF_TEXT_LIMIT'
                ? 'PDF 第 {page} 页超出文字总量限制，请缩小页码范围。'
                : 'PDF 第 {page} 页解析失败，已完成的页面已保留。',
              { page: error.sourcePage! },
            ),
          );
        }
      } else {
        // Terminal conversion failures such as PDF_NO_TEXT need a new range,
        // not an endless Continue action over the same cached pages.
        setError(errorText(error));
        transition('range');
      }
    } finally {
      if (running.current === run) running.current = null;
    }
  }
  function pause() {
    const run = running.current;
    if (!run || !currentRun(run) || phaseRef.current !== 'parsing') return;
    transition('pausing');
    run.controller.abort();
  }
  function chooseRange() {
    if (running.current || phaseRef.current === 'saving' || dismissed.current) return;
    setReport(null);
    setInterruption(null);
    setError('');
    transition('range');
  }
  function dismiss() {
    if (phaseRef.current === 'saving' || dismissed.current) return;
    dismissed.current = true;
    generation.current++;
    opening.current?.abort();
    running.current?.controller.abort();
    running.current = null;
    const value = active.current;
    active.current = null;
    void value?.close().catch(() => {});
    setPassword('');
    close();
  }
  const busy = ['opening', 'parsing', 'pausing', 'saving'].includes(phase);
  return (
    <Modal title={t('解析 PDF')} close={dismiss} mobileSheet>
      <div className="mt-5 space-y-5">
        <div className="flex items-center gap-3">
          <FileText className="shrink-0 text-primary" />
          <p className="truncate text-sm">{file.name}</p>
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          {t('在本机提取文字，按原始页码转为可阅读、搜索、划线和翻译的书籍格式。')}
        </p>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 p-3 text-sm leading-6 text-destructive"
          >
            {error}
          </p>
        )}
        {phase === 'password' && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void load(password);
            }}
          >
            <label className="space-y-2 block text-sm">
              <span>{t('PDF 密码')}</span>
              <Input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                maxLength={256}
              />
            </label>
            <Button type="submit" disabled={!password}>
              {t('解锁 PDF')}
            </Button>
          </form>
        )}
        {phase === 'range' && session && (
          <>
            <p className="text-sm text-muted-foreground">
              {t('共 {n} 页', { n: session.totalPages })}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <label className="space-y-2 text-sm">
                <span>{t('起始页')}</span>
                <Input
                  inputMode="numeric"
                  type="number"
                  min={1}
                  max={session.totalPages}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>{t('结束页')}</span>
                <Input
                  inputMode="numeric"
                  type="number"
                  min={1}
                  max={session.totalPages}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              {t('保留文字与页码出处。复杂表格、公式和图片不会还原为原版版式。')}
            </p>
            <p className="text-xs leading-6 text-muted-foreground">
              {t('原 PDF 仅保存在本机，不随书籍同步或阅读包导出。')}
            </p>
            <Button disabled={!rangeValid} onClick={() => void parse()}>
              {t('开始解析')}
            </Button>
          </>
        )}
        {(phase === 'opening' || phase === 'parsing' || phase === 'pausing') && (
          <div role="status" className="space-y-4 py-5">
            <LoaderCircle className="animate-spin text-primary" />
            <p className="text-sm">
              {phase === 'opening'
                ? t('正在读取 PDF…')
                : phase === 'pausing'
                  ? t('正在暂停，等待当前页结束…')
                  : t('正在解析 {page} / {total} 页', {
                      page: progress.page,
                      total: progress.total,
                    })}
            </p>
            {phase !== 'opening' && (
              <progress
                aria-label={t('解析进度')}
                max={progress.total}
                value={progress.page}
                className="w-full accent-primary"
              />
            )}
            {phase === 'parsing' && (
              <Button variant="secondary" onClick={pause}>
                {t('暂停解析')}
              </Button>
            )}
          </div>
        )}
        {(phase === 'paused' || phase === 'interrupted') && interruption && (
          <div className="space-y-4">
            <div role="status" className="space-y-2 text-sm">
              {phase === 'paused' && <p>{t('解析已暂停')}</p>}
              <p>
                {t('已完成 {completed} / {total} 页', {
                  completed: progress.page,
                  total: progress.total,
                })}
              </p>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              {t('暂停仅保留在本次打开的 PDF 中；关闭后需要重新解析。')}
            </p>
            <div className="flex flex-wrap gap-3">
              {interruption.code !== 'PDF_TEXT_LIMIT' && (
                <Button onClick={() => void parse()}>
                  {interruption.code === 'PDF_PAUSED'
                    ? t('继续解析')
                    : t('重试第 {page} 页', { page: interruption.sourcePage! })}
                </Button>
              )}
              <Button variant="secondary" onClick={chooseRange}>
                {t('重新选择页码')}
              </Button>
            </div>
          </div>
        )}
        {(phase === 'preview' || phase === 'saving') && report && (
          <>
            <label className="block space-y-2 text-sm">
              <span>{t('书名')}</span>
              <Input
                value={title}
                maxLength={2000}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            {preview && (
              <p className="text-sm">
                {t('已转换 {n} 页，可导入书架。', { n: report.importedPages })}
              </p>
            )}
            <PdfImportPreview report={report} preview={preview} disabled={busy} />
            <div className="flex gap-3">
              <Button
                disabled={busy || !preview || !title.trim()}
                onClick={() => {
                  if (
                    phaseRef.current !== 'preview' ||
                    dismissed.current ||
                    !preview ||
                    !title.trim()
                  )
                    return;
                  const token = generation.current;
                  transition('saving');
                  setError('');
                  void save({ ...report.book, title: title.trim() }).catch(() => {
                    if (
                      !mounted.current ||
                      dismissed.current ||
                      generation.current !== token ||
                      currentFile.current !== file
                    )
                      return;
                    transition('preview');
                    setError(t('导入失败，请重试。'));
                  });
                }}
              >
                {phase === 'saving' ? t('正在导入…') : t('导入书架')}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={chooseRange}>
                {t('重新选择页码')}
              </Button>
            </div>
          </>
        )}
        {phase === 'error' && <Button onClick={() => void load()}>{t('重试')}</Button>}
        {phase !== 'saving' && (
          <Button variant="ghost" onClick={dismiss}>
            {t('取消')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
