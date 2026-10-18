'use client';

import { readingProgress } from '@/lib/reading-progress';

import { useI18n } from '@/lib/i18n/provider';
import { ContentLanguageLabel } from '@/components/library/language-menu';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Moon, Sun, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { languages, type Chapter, type Settings } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ReadingModePicker } from './reading-navigation';

export function ReadingPanel({
  open,
  onOpenChange,
  title,
  compact = false,
  autoFocusSelector,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  compact?: boolean;
  autoFocusSelector?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const previousFocus = useRef<HTMLElement | null>(null);
  const sheetStart = useRef<number | null>(null);
  const sheetDragged = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const update = () => {
      content.current?.style.setProperty(
        '--reading-viewport-height',
        `${viewport?.height ?? window.innerHeight}px`,
      );
      content.current?.style.setProperty(
        '--reading-viewport-bottom',
        `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`,
      );
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        data-reader-panel
        overlayClassName="reading-backdrop"
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          'reading-panel left-auto top-auto flex translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden border-0 bg-card p-0',
          compact && 'reading-panel-compact',
        )}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => {
            if (document.querySelector('[data-slot="dialog-content"][data-state="open"]')) return;
            const trigger = previousFocus.current;
            const target =
              trigger?.isConnected && trigger.getClientRects().length
                ? trigger
                : document.getElementById('reading-surface');
            target?.focus({ preventScroll: true });
          });
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          previousFocus.current =
            document.activeElement instanceof HTMLElement &&
            !document.activeElement.closest('[data-slot="dialog-content"]')
              ? document.activeElement
              : previousFocus.current;
          const target = autoFocusSelector
            ? content.current?.querySelector<HTMLElement>(autoFocusSelector)
            : content.current?.querySelector<HTMLElement>('[data-panel-title]');
          target?.focus({ preventScroll: true });
          content.current
            ?.querySelector('[aria-current="location"]')
            ?.scrollIntoView({ block: 'nearest' });
        }}
      >
        <button
          className="flex h-7 w-full shrink-0 touch-none items-center justify-center md:hidden"
          aria-label={t('收起{value0}', { value0: title })}
          onPointerDown={(event) => {
            sheetStart.current = event.clientY;
            sheetDragged.current = false;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            if (sheetStart.current !== null) {
              const distance = event.clientY - sheetStart.current;
              sheetDragged.current = Math.abs(distance) > 8;
              if (distance > 60) onOpenChange(false);
            }
            sheetStart.current = null;
          }}
          onPointerCancel={() => {
            sheetStart.current = null;
          }}
          onClick={() => {
            if (!sheetDragged.current) onOpenChange(false);
          }}
        >
          <span className="h-1 w-9 rounded-full bg-border" />
        </button>
        <header className="flex h-[68px] shrink-0 items-center justify-between px-7">
          <DialogTitle
            tabIndex={-1}
            data-panel-title
            className="text-lg font-semibold outline-none"
          >
            {title}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-muted-foreground"
            onClick={() => onOpenChange(false)}
            aria-label={t('关闭{value0}', { value0: title })}
          >
            <X size={20} />
          </Button>
        </header>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function ReadingAppearance({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="overflow-y-auto px-7 pb-7 text-sm">
      <ReadingModePicker
        mode={settings.navigationMode}
        onChange={(navigationMode) => update({ navigationMode })}
      />
      <div
        className="reading-submode-picker"
        role="group"
        aria-label={settings.navigationMode === 'paged' ? t('翻页效果') : t('滚动跨章')}
      >
        {settings.navigationMode === 'paged'
          ? (
              [
                ['curl', t('卷页')],
                ['slide', t('平移')],
                ['none', t('无动画')],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={settings.pageEffect === value}
                onClick={() => update({ pageEffect: value })}
              >
                {label}
              </button>
            ))
          : (
              [
                ['continuous', t('连续跨章')],
                ['chapter', t('章末停下')],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={settings.scrollFlow === value}
                onClick={() => update({ scrollFlow: value })}
              >
                {label}
              </button>
            ))}
      </div>
      <div className="mb-4 flex items-center gap-5 md:mb-6">
        <span className="text-sm text-muted-foreground" aria-hidden="true">
          A
        </span>
        <Slider
          aria-label={t('正文字号')}
          min={15}
          max={26}
          step={1}
          value={[settings.fontSize]}
          onValueChange={([fontSize]) => update({ fontSize })}
        />
        <span className="text-xl text-muted-foreground" aria-hidden="true">
          A
        </span>
        <span className="w-6 text-end tabular-nums text-muted-foreground">{settings.fontSize}</span>
      </div>
      <ToggleGroup
        type="single"
        value={settings.fontFamily}
        onValueChange={(value) => value && update({ fontFamily: value as Settings['fontFamily'] })}
        className="mb-6 hidden grid-cols-2 gap-3 md:grid"
        aria-label={t('正文字体')}
      >
        {(
          [
            ['system', t('系统字体')],
            ['serif', t('宋体 / 衬线')],
          ] as const
        ).map(([value, label]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            className={cn(
              'relative flex h-20 flex-col gap-1 rounded-xl border bg-muted/40 text-muted-foreground data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:text-primary data-[state=on]:shadow-none',
              value === 'serif' && 'font-serif',
            )}
            aria-label={label}
          >
            <span className="text-xl">{t('阅读 Aa')}</span>
            <span className="text-xs">{label}</span>
            {settings.fontFamily === value && (
              <Check size={12} className="absolute right-2 top-2" />
            )}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="mb-3 flex items-center gap-4 md:hidden">
        <span className="min-w-20 shrink-0 whitespace-nowrap text-muted-foreground">
          {t('字体')}
        </span>
        <Select
          value={settings.fontFamily}
          onValueChange={(fontFamily) =>
            update({ fontFamily: fontFamily as Settings['fontFamily'] })
          }
        >
          <SelectTrigger
            aria-label={t('正文字体')}
            className="h-9 flex-1 rounded-full bg-muted/40 text-sm shadow-none"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">{t('系统字体')}</SelectItem>
            <SelectItem value="serif">{t('宋体 / 衬线')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mb-2 flex items-center gap-4 md:mb-4">
        <span className="min-w-20 shrink-0 whitespace-nowrap text-muted-foreground">
          {t('行距')}
        </span>
        <Slider
          aria-label={t('正文行距')}
          min={1.5}
          max={2.4}
          step={0.1}
          value={[settings.lineHeight]}
          onValueChange={([lineHeight]) => update({ lineHeight })}
        />
        <span className="w-8 text-end text-xs tabular-nums text-muted-foreground">
          {settings.lineHeight.toFixed(1)}
        </span>
      </div>
      <div className="mb-6 hidden items-center gap-4 md:flex">
        <span className="min-w-20 shrink-0 whitespace-nowrap text-muted-foreground">
          {t('页宽')}
        </span>
        <Slider
          aria-label={t('正文页宽')}
          min={560}
          max={840}
          step={40}
          value={[settings.pageWidth]}
          onValueChange={([pageWidth]) => update({ pageWidth })}
        />
        <span className="w-8 text-end text-xs tabular-nums text-muted-foreground">
          {settings.pageWidth}
        </span>
      </div>
      <div className="mb-4 flex items-center gap-4 md:hidden">
        <span className="min-w-20 shrink-0 whitespace-nowrap text-muted-foreground">
          {t('边距')}
        </span>
        <Slider
          aria-label={t('正文边距')}
          min={16}
          max={36}
          step={2}
          value={[settings.pageMargin]}
          onValueChange={([pageMargin]) => update({ pageMargin })}
        />
        <span className="w-8 text-end text-xs tabular-nums text-muted-foreground">
          {settings.pageMargin}
        </span>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:mb-6">
        {(
          [
            ['paper', Sun, t('日间')],
            ['night', Moon, t('夜间')],
          ] as const
        ).map(([theme, Icon, label]) => (
          <Button
            key={theme}
            variant="outline"
            aria-pressed={settings.theme === theme}
            className={cn(
              'h-11 rounded-full border-border bg-transparent font-normal shadow-none',
              settings.theme === theme && 'border-primary text-primary',
            )}
            onClick={() => update({ theme })}
          >
            <Icon size={16} />
            {label}
          </Button>
        ))}
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        {t('调整会立即应用，关闭面板后继续阅读。')}
      </p>
    </div>
  );
}

export function ReadingLanguage({
  settings,
  update,
  openSettings,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  openSettings: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="overflow-y-auto px-7 pb-7 text-sm">
      <ToggleGroup
        type="single"
        value={settings.readingMode}
        onValueChange={(value) =>
          value && update({ readingMode: value as Settings['readingMode'] })
        }
        className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1"
        aria-label={t('阅读语言模式')}
      >
        {(
          [
            ['original', t('原文')],
            ['bilingual', t('双语')],
            ['translation', t('译文')],
          ] as const
        ).map(([value, label]) => (
          <ToggleGroupItem key={value} value={value} className="h-11 rounded-full text-sm">
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="my-5 min-h-12 text-xs leading-6 text-muted-foreground">
        {settings.readingMode === 'original'
          ? t('只显示原文，自动翻译暂停。')
          : settings.readingMode === 'bilingual'
            ? t('原文在上，译文在下，逐段对照阅读。')
            : t('优先显示译文；译文准备好之前保留原文。')}
      </p>
      <label className="mb-3 block text-xs text-muted-foreground">{t('翻译语言')}</label>
      <Select value={settings.language} onValueChange={(language) => update({ language })}>
        <SelectTrigger aria-label={t('翻译语言')} className="h-11 w-full rounded-xl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {languages.map(([value, label]) => (
            <SelectItem value={value} key={value}>
              <ContentLanguageLabel code={value} nativeName={label} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-4 text-xs leading-6 text-muted-foreground">
        {t('双语和译文模式按需翻译眼前内容，已完成的译文会保存在本机。')}
      </p>
      <Button variant="link" className="mt-4 h-auto p-0 text-xs font-normal" onClick={openSettings}>
        {t('翻译与 AI 连接设置')}
      </Button>
    </div>
  );
}

export function ReadingProgress({
  chapters,
  paragraph,
  navigate,
}: {
  chapters: Chapter[];
  paragraph: string;
  navigate: (id: string) => void;
}) {
  const { t } = useI18n();
  const passages = chapters.flatMap((chapter) =>
    chapter.paragraphs.map((passage) => ({ ...passage, chapter: chapter.title })),
  );
  const [cursor, setCursor] = useState(
    Math.max(
      0,
      passages.findIndex((item) => item.id === paragraph),
    ),
  );
  const current = passages[cursor];
  return (
    <div className="px-7 pb-8">
      <p className="mb-2 text-sm leading-7">{current?.chapter}</p>
      <p className="mb-6 line-clamp-2 min-h-12 text-xs leading-6 text-muted-foreground">
        {current?.text}
      </p>
      <Slider
        aria-label={t('阅读位置')}
        min={0}
        max={Math.max(1, passages.length - 1)}
        step={1}
        value={[cursor]}
        onValueChange={([value]) => setCursor(value)}
        disabled={passages.length < 2}
        onValueCommit={([value]) => {
          if (passages[value]) navigate(passages[value].id);
        }}
      />
      <div className="mt-4 flex justify-between text-xs text-muted-foreground">
        <span>{t('按段落定位 · 松开后跳转')}</span>
        <span>
          {Math.min(
            99,
            Math.round(readingProgress(chapters, { paragraph: current?.id || '' }) * 100),
          )}
          %
        </span>
      </div>
    </div>
  );
}
