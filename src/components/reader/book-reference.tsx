'use client';

import { Fragment, useRef, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type {
  BookReferenceLink,
  BookReferenceTarget,
  Note,
  NoteAnchor,
  Paragraph,
} from '../../../packages/reading-core/src/types';
import { noteRange } from '@/lib/note-anchors';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type InlineBookReference = {
  link: BookReferenceLink;
  start: number;
  end: number;
  href: string;
};
type OpenReference = (link: BookReferenceLink, opener: HTMLElement) => void;

/** Marks and links decorate the same UTF-16 slices; the source text stays byte-for-byte intact. */
export function MarkedPassage({
  text,
  notes,
  source = 'original',
  translationKey,
  references = [],
  openReference,
}: {
  text: string;
  notes: Note[];
  source?: NoteAnchor['source'];
  translationKey?: string;
  references?: InlineBookReference[];
  openReference?: OpenReference;
}) {
  const { t } = useI18n();
  const ranges = notes
    .flatMap((note) => {
      const range = noteRange(text, note, source, translationKey);
      return range ? [range] : [];
    })
    .sort((a, b) => a.start - b.start);
  const marks: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const previous = marks.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else marks.push({ ...range });
  }
  const links: InlineBookReference[] = [];
  if (source === 'original' && openReference)
    for (const reference of [...references].sort((a, b) => a.start - b.start || a.end - b.end)) {
      if (
        reference.start < 0 ||
        reference.end > text.length ||
        reference.end <= reference.start ||
        reference.start < (links.at(-1)?.end || 0)
      )
        continue;
      links.push(reference);
    }
  const cuts = [
    ...new Set([
      0,
      text.length,
      ...marks.flatMap((r) => [r.start, r.end]),
      ...links.flatMap((r) => [r.start, r.end]),
    ]),
  ].sort((a, b) => a - b);
  const groups: { start: number; reference?: InlineBookReference; children: ReactNode[] }[] = [];
  let markIndex = 0;
  let linkIndex = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i];
    const end = cuts[i + 1];
    while (marks[markIndex]?.end <= start) markIndex++;
    while (links[linkIndex]?.end <= start) linkIndex++;
    const marked = marks[markIndex]?.start <= start && marks[markIndex]?.end >= end;
    const reference =
      links[linkIndex]?.start <= start && links[linkIndex]?.end >= end
        ? links[linkIndex]
        : undefined;
    const piece = marked ? (
      <mark className="passage-mark" key={start}>
        {text.slice(start, end)}
      </mark>
    ) : (
      <Fragment key={start}>{text.slice(start, end)}</Fragment>
    );
    const previous = groups.at(-1);
    if (previous && previous.reference === reference) previous.children.push(piece);
    else groups.push({ start, reference, children: [piece] });
  }
  return (
    <>
      {groups.map(({ start, reference, children }) =>
        reference ? (
          <a
            key={start}
            href={reference.href}
            className="book-reference-link"
            data-book-reference={reference.link.id}
            aria-label={`${t(reference.link.kind === 'footnote' ? '脚注' : '书内引用')} · ${text.slice(reference.start, reference.end)}`}
            aria-haspopup={reference.link.kind === 'footnote' ? 'dialog' : undefined}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!window.getSelection()?.toString().trim())
                openReference?.(reference.link, event.currentTarget);
            }}
          >
            {children}
          </a>
        ) : (
          <Fragment key={start}>{children}</Fragment>
        ),
      )}
    </>
  );
}

/** In translation-only mode, references remain separate from translated character offsets. */
export function OriginalReferences({
  references,
  open,
  paragraphs,
}: {
  references: InlineBookReference[];
  open: OpenReference;
  paragraphs: ReadonlyMap<string, Paragraph>;
}) {
  const { t } = useI18n();
  const unique = [...new Map(references.map((entry) => [entry.link.id, entry])).values()];
  if (!unique.length) return null;
  return (
    <div className="book-original-references" aria-label={t('原文引用')}>
      <span>{t('原文引用')}</span>
      {unique.map(({ link }) => {
        const label = link.source
          .map(
            (range) => paragraphs.get(range.paragraphId)?.text.slice(range.start, range.end) || '',
          )
          .join('');
        return (
          <button type="button" key={link.id} onClick={(event) => open(link, event.currentTarget)}>
            {label.length > 80 ? `${label.slice(0, 80)}…` : label}
          </button>
        );
      })}
    </div>
  );
}

export function BookReferencePreview({
  link,
  target,
  paragraphs,
  language,
  opener,
  close,
  visit,
}: {
  link: BookReferenceLink;
  target: BookReferenceTarget;
  paragraphs: ReadonlyMap<string, Paragraph>;
  language: string;
  opener: HTMLElement | null;
  close: () => void;
  visit: () => void;
}) {
  const { t } = useI18n();
  const navigating = useRef(false);
  const content = target.location
    ? target.paragraphIds.flatMap((id) => {
        const paragraph = paragraphs.get(id);
        return paragraph ? [paragraph] : [];
      })
    : target.content;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!navigating.current && opener?.isConnected) opener.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="border-b px-6 py-5 text-start">
          <DialogTitle className="pe-6">
            {t(link.kind === 'footnote' ? '脚注' : '书内引用')}
          </DialogTitle>
        </DialogHeader>
        <div
          className="book-reference-preview min-h-0 overflow-y-auto overscroll-contain px-6 py-5"
          lang={language === 'auto' ? undefined : language}
          dir="auto"
        >
          {content.map((paragraph, index) =>
            paragraph.kind === 'heading' ? (
              <h3 key={index}>{paragraph.text}</h3>
            ) : paragraph.kind === 'code' ? (
              <pre key={index}>{paragraph.text}</pre>
            ) : (
              <p key={index}>{paragraph.text}</p>
            ),
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-6 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          {!target.location && (
            <p className="me-auto text-xs leading-5 text-muted-foreground">
              {t('此附注没有独立的正文位置。')}
            </p>
          )}
          <Button variant="ghost" onClick={close}>
            {t('关闭')}
          </Button>
          {target.location && (
            <Button
              onClick={() => {
                navigating.current = true;
                visit();
              }}
            >
              {t('在正文中查看')}
              <ArrowUpRight size={15} />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
