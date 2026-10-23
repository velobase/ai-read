'use client';

import { useMemo, useRef, useState } from 'react';
import {
  PDF_PREVIEW_PARAGRAPHS_PER_BATCH,
  type PdfImportPreview as Preview,
  type PdfImportReport,
} from '../../../packages/reading-core/src';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Filter = 'all' | 'empty' | 'ocr';

/** A new report owns a new preview, even when its book ID and page range match. */
export function PdfImportPreview({
  report,
  preview,
  disabled,
}: {
  report: PdfImportReport;
  preview: Preview | null;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const identity = useRef({ report, revision: 0 });
  if (identity.current.report !== report)
    identity.current = { report, revision: identity.current.revision + 1 };
  if (!preview)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('PDF 解析失败，请检查文件或尝试较小的页码范围。')}
      </p>
    );
  return <PreviewPages key={identity.current.revision} preview={preview} disabled={disabled} />;
}

function PreviewPages({ preview, disabled }: { preview: Preview; disabled: boolean }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(preview.pages[0].sourcePage);
  const [input, setInput] = useState(String(page));
  const [batch, setBatch] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const busy = useRef(disabled);
  busy.current = disabled;
  const groups = useMemo(
    () => ({
      all: preview.pages,
      empty: preview.pages.filter((item) => item.method === 'empty'),
      ocr: preview.pages.filter((item) => item.method === 'ocr'),
    }),
    [preview],
  );
  const pages = groups[filter];
  const index = pages.findIndex((item) => item.sourcePage === page);
  const current = preview.byPage.get(page)!;
  const start = batch * PDF_PREVIEW_PARAGRAPHS_PER_BATCH;
  const paragraphs = current.paragraphs.slice(start, start + PDF_PREVIEW_PARAGRAPHS_PER_BATCH);
  const text = useRef<HTMLDivElement>(null);
  function selectPage(next: number | undefined) {
    if (busy.current || next === undefined || !preview.byPage.has(next)) return;
    setPage(next);
    setInput(String(next));
    setBatch(0);
    setInvalid(false);
    text.current?.scrollTo({ top: 0 });
  }
  function selectFilter(next: Filter) {
    if (busy.current || !groups[next].length) return;
    setFilter(next);
    selectPage(groups[next][0].sourcePage);
  }
  function jump() {
    if (busy.current) return;
    const value = input.trim();
    const number = /^[0-9]+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number) || !preview.byPage.has(number)) {
      setInvalid(true);
      return;
    }
    setFilter('all');
    selectPage(number);
  }
  function moveBatch(next: number) {
    if (
      busy.current ||
      next < 0 ||
      next * PDF_PREVIEW_PARAGRAPHS_PER_BATCH >= current.paragraphs.length
    )
      return;
    setBatch(next);
    text.current?.scrollTo({ top: 0 });
  }
  return (
    <section className="space-y-3 rounded-xl border p-4" aria-label={t('解析预览')}>
      {(groups.empty.length > 0 || groups.ocr.length > 0) && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('解析预览')}>
          {(
            [
              'all',
              ...(groups.empty.length ? ['empty'] : []),
              ...(groups.ocr.length ? ['ocr'] : []),
            ] as Filter[]
          ).map((value) => (
            <Button
              key={value}
              type="button"
              variant={filter === value ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={filter === value}
              disabled={disabled || !groups[value].length}
              onClick={() => selectFilter(value)}
            >
              {t(
                value === 'all'
                  ? '所有页（{count}）'
                  : value === 'empty'
                    ? '无文字页（{count}）'
                    : 'OCR 页（{count}）',
                { count: groups[value].length },
              )}
            </Button>
          ))}
        </div>
      )}
      {pages.length > 1 ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            jump();
          }}
        >
          <label className="flex items-center gap-2 text-xs">
            {t('原 PDF 页码')}
            <Input
              className="h-9 w-20 text-center"
              inputMode="numeric"
              maxLength={12}
              value={input}
              disabled={disabled}
              aria-invalid={invalid}
              onChange={(event) => {
                if (!busy.current) {
                  setInput(event.target.value);
                  setInvalid(false);
                }
              }}
            />
          </label>
          <Button type="submit" variant="secondary" size="sm" disabled={disabled}>
            {t('跳转')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || index <= 0}
            onClick={() => selectPage(pages[index - 1]?.sourcePage)}
          >
            {t('上一页')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || index < 0 || index >= pages.length - 1}
            onClick={() => selectPage(pages[index + 1]?.sourcePage)}
          >
            {t('下一页')}
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('PDF 第 {n} 页', { n: current.sourcePage })}
        </p>
      )}
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          {t('请输入本次解析范围内的整数页码。')}
        </p>
      )}
      {current.method === 'empty' ? (
        <p className="rounded-lg bg-muted p-4 text-sm leading-7 text-muted-foreground">
          {t('此页未提取到文字，不会导入正文。')}
        </p>
      ) : (
        <>
          {current.method === 'ocr' && (
            <p className="text-xs text-muted-foreground">{t('请核对 OCR 识别结果。')}</p>
          )}
          <div
            ref={text}
            tabIndex={0}
            aria-label={t('解析预览')}
            className="max-h-64 space-y-4 overflow-y-auto overscroll-contain rounded-lg bg-muted p-4"
          >
            {paragraphs.map((paragraph) => (
              <p key={paragraph.id} className="whitespace-pre-wrap break-words text-sm leading-7">
                {paragraph.text}
              </p>
            ))}
          </div>
          {current.paragraphs.length > PDF_PREVIEW_PARAGRAPHS_PER_BATCH && (
            <>
              <p className="text-xs text-muted-foreground">
                {t('第 {from}–{to} 段，共 {count} 段', {
                  from: start + 1,
                  to: start + paragraphs.length,
                  count: current.paragraphs.length,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || batch === 0}
                  onClick={() => moveBatch(batch - 1)}
                >
                  {t('上一批段落')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || start + paragraphs.length >= current.paragraphs.length}
                  onClick={() => moveBatch(batch + 1)}
                >
                  {t('下一批段落')}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
