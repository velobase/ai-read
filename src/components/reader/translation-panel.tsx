'use client';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { BookOpen, Check, LoaderCircle, Pause, Play, RefreshCw } from 'lucide-react';
import type { BookTranslationController } from './use-book-translation';
import type { Book } from '@/lib/types';

export function TranslationPanel({
  controller: c,
  book,
  chapter,
  connect,
}: {
  controller: BookTranslationController;
  book: Book;
  chapter: number;
  connect: () => void;
}) {
  const { locale, number } = useI18n();
  const zh = locale.startsWith('zh');
  const work = c.work;
  const completed = work ? work.chapters.filter((p) => p.state === 'ready').length : c.legacyCount;
  const active = work?.state === 'active';
  const progress = work?.chapters[chapter];
  const remainingChars = book.chapters.reduce(
    (sum, item, index) =>
      sum +
      (work?.chapters[index]?.state === 'ready'
        ? 0
        : item.paragraphs.reduce((n, p) => n + p.text.length, 0)),
    0,
  );
  const call = (action: 'prepare' | 'pause' | 'resume', scope: 'book' | 'chapter' = 'chapter') =>
    void c.command({ action, chapter, scope, editionId: work?.id });
  if (c.sameLanguage)
    return (
      <p className="text-sm leading-7 text-muted-foreground">
        {zh
          ? '原文已经是目标语言，可以直接阅读。'
          : 'The original is already in your target language and ready to read.'}
      </p>
    );
  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">
            {zh ? '已准备' : 'Prepared'} {number(completed)} / {number(book.chapters.length)}{' '}
            {zh ? '章' : 'chapters'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {work?.profile.model || (zh ? '准备一次，随时阅读' : 'Prepare once, read anytime')}
          </p>
        </div>
        {active ? (
          <LoaderCircle size={19} className="animate-spin text-primary" />
        ) : completed === book.chapters.length ? (
          <Check size={20} className="text-primary" />
        ) : (
          <BookOpen size={20} className="text-muted-foreground" />
        )}
      </div>
      <progress
        className="h-2 w-full accent-primary"
        value={completed}
        max={book.chapters.length}
        aria-label={zh ? '整本译文准备进度' : 'Book translation progress'}
      />
      {progress && progress.state !== 'ready' && progress.state !== 'missing' && (
        <p className="text-xs text-muted-foreground" role="status">
          {zh ? '本章进度' : 'This chapter'} ·{' '}
          {number(Math.floor((progress.completedChunks / Math.max(1, progress.totalChunks)) * 100))}
          %{work?.state === 'paused' ? (zh ? ' · 已暂停' : ' · Paused') : ''}
        </p>
      )}
      <p className="text-xs leading-6 text-muted-foreground">
        {c.accounts
          ? zh
            ? '任务在后台继续，关闭页面也不会中断。已下载的完整章节可离线阅读。'
            : 'Preparation continues after you close this page. Downloaded chapters are available offline.'
          : zh
            ? '可以离开阅读页；关闭浏览器后暂停，下次打开从保存的断点继续。'
            : 'You can leave the reader. Closing the browser pauses preparation; saved checkpoints resume next time.'}
        {c.edition && (
          <span className="block">
            {zh ? '当前译本已下载到本机：' : 'Current edition downloaded: '}
            {number(c.cached)} / {number(book.chapters.length)} {zh ? '章' : 'chapters'}
          </span>
        )}
      </p>
      {(!c.online || c.error || work?.error) && (
        <p className="rounded-lg bg-muted p-3 text-xs leading-6" role="status">
          {!c.online
            ? zh
              ? '当前离线，已保存译文仍可阅读。'
              : 'Offline. Saved translations remain available.'
            : c.error || work?.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!c.canPrepare ? (
          <Button onClick={connect}>{zh ? '登录或查看翻译服务' : 'Sign in or check translation service'}</Button>
        ) : (
          <>
            {active ? (
              <Button
                variant="outline"
                disabled={c.busy || !c.online}
                onClick={() => call('pause')}
              >
                <Pause size={15} />
                {zh ? '暂停准备' : 'Pause'}
              </Button>
            ) : (
              completed < book.chapters.length && (
                <Button
                  variant="outline"
                  disabled={c.busy || !c.online}
                  onClick={() =>
                    call(work?.state === 'paused' || work?.state === 'error' ? 'resume' : 'prepare')
                  }
                >
                  <Play size={15} />
                  {work?.state === 'paused' || work?.state === 'error'
                    ? zh
                      ? '继续准备'
                      : 'Resume'
                    : zh
                      ? '准备本章和下一章'
                      : 'Prepare this and next chapter'}
                </Button>
              )
            )}
            {completed < book.chapters.length && (
              <Button disabled={c.busy || !c.online} onClick={() => call('prepare', 'book')}>
                {zh ? '准备整本译文' : 'Prepare entire book'}
              </Button>
            )}
          </>
        )}
      </div>
      {work && work.id !== c.edition?.id && completed === book.chapters.length && (
        <Button
          disabled={c.busy || !c.online}
          onClick={() => void c.command({ action: 'select', editionId: work.id, chapter })}
        >
          {zh ? '新译本已就绪 · 切换阅读' : 'New edition ready · Switch'}
        </Button>
      )}
      {remainingChars > 0 && (
        <p className="text-xs text-muted-foreground">
          {zh
            ? `整本剩余约 ${number(remainingChars)} 字符，由 LeafRead 提供翻译服务。`
            : `About ${number(remainingChars)} source characters remain. Translation is provided by LeafRead.`}
        </p>
      )}
      {c.manifest.editions.length > 1 && (
        <label className="block space-y-2 text-xs">
          <span>{zh ? '阅读的译本' : 'Reading edition'}</span>
          <select
            className="w-full rounded-lg border border-border bg-background p-2"
            value={c.manifest.selectedId || ''}
            disabled={c.busy}
            onChange={(e) =>
              void c.command({ action: 'select', editionId: e.target.value, chapter })
            }
          >
            {c.manifest.editions.map((e) => (
              <option
                key={e.id}
                value={e.id}
                disabled={
                  e.id !== c.manifest.selectedId &&
                  e.createdAt >= (c.edition?.createdAt || 0) &&
                  e.chapters.some((p) => p.state !== 'ready')
                }
              >
                {e.profile.model} · {new Date(e.createdAt).toLocaleString(locale)}
                {e.chapters.some((p) => p.state !== 'ready')
                  ? zh
                    ? ' · 准备中'
                    : ' · Preparing'
                  : ''}
              </option>
            ))}
          </select>
          <p className="leading-6 text-muted-foreground">
            {zh
              ? '新译本完成后再切换，现有译文和笔记保留。'
              : 'Switch when the new edition is complete. Existing translations and notes are retained.'}
          </p>
        </label>
      )}
      {(c.edition || c.legacyCount > 0) && c.canPrepare && (
        <details className="border-t border-border pt-4">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {zh ? '更换翻译风格或模型' : 'Change translation style or model'}
          </summary>
          <p className="my-3 text-xs leading-6 text-muted-foreground">
            {zh
              ? '修改模型设置不会改变正在阅读的译本。使用最新设置重新翻译，会保留旧版并生成完整的新译本。'
              : 'Changing settings leaves this edition intact. Retranslate with your latest settings to create a complete new edition.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={c.busy || !c.online || active}
            onClick={() =>
              void c.command({
                action: 'new',
                chapter,
                scope: 'book',
                requestId: crypto.randomUUID(),
              })
            }
          >
            <RefreshCw size={14} />
            {zh ? '按最新设置重译整本' : 'Retranslate book with latest settings'}
          </Button>
        </details>
      )}
    </div>
  );
}

export function ChapterPreparation({
  controller: c,
  index,
  open,
  original,
  connect,
}: {
  controller: BookTranslationController;
  index: number;
  open: () => void;
  original: () => void;
  connect: () => void;
}) {
  const { locale, number } = useI18n();
  const zh = locale.startsWith('zh');
  const state = c.edition?.chapters[index];
  const paused = c.edition?.state === 'paused';
  const error = c.error || state?.error;
  const active = c.edition?.state === 'active';
  return (
    <div className="chapter-preparation" role="status">
      {active && c.online ? (
        <LoaderCircle className="animate-spin text-primary" size={25} />
      ) : (
        <BookOpen size={25} className="text-primary" />
      )}
      <p className="mt-5 text-lg font-medium">
        {paused
          ? zh
            ? '本章译文已暂停准备'
            : 'Chapter preparation paused'
          : error
            ? zh
              ? '本章译文尚未就绪'
              : 'This chapter is not ready yet'
            : !c.online
              ? zh
                ? '本章尚未下载'
                : 'This chapter is not downloaded'
              : active
                ? zh
                  ? '正在准备完整章节'
                  : 'Preparing the complete chapter'
                : zh
                  ? '准备本章译文'
                  : 'Prepare this chapter'}
      </p>
      <p className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">
        {!c.online
          ? zh
            ? '已保存的章节仍可阅读，联网后继续下载。'
            : 'Saved chapters remain readable. Reconnect to download more.'
          : error ||
            (zh
              ? '整章准备好后自动打开，阅读中不再逐段等待。也可以先读原文。'
              : 'The complete chapter opens when ready, without paragraph-by-paragraph waits. You can read the original meanwhile.')}
      </p>
      {state && active && (
        <div className="mt-5 w-48">
          <progress
            className="h-1.5 w-full accent-primary"
            value={state.completedChunks}
            max={Math.max(1, state.totalChunks)}
            aria-label={zh ? '本章准备进度' : 'Chapter preparation progress'}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {number(Math.floor((state.completedChunks / Math.max(1, state.totalChunks)) * 100))}%
          </p>
        </div>
      )}
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button variant="outline" onClick={original}>
          {zh ? '先读原文' : 'Read original'}
        </Button>
        <Button onClick={c.canPrepare ? open : connect}>
          {c.canPrepare
            ? zh
              ? '查看准备进度'
              : 'View preparation'
            : zh
              ? '连接翻译模型'
              : 'Connect a model'}
        </Button>
      </div>
    </div>
  );
}
