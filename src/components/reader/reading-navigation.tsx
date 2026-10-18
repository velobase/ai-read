'use client';

import { useI18n } from '@/lib/i18n/provider';

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronsLeftRight,
  List,
  MoveVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Chapter, Settings } from '@/lib/types';
import './reading-navigation.css';

export function ReadingModePicker({
  mode,
  onChange,
}: {
  mode: Settings['navigationMode'];
  onChange: (mode: Settings['navigationMode']) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="reading-mode-picker">
      <legend>{t('阅读方式')}</legend>
      <div className="reading-mode-options">
        {(
          [
            {
              value: 'paged',
              title: t('翻页'),
              detail: t('一屏一屏，从容往下读'),
              Icon: ChevronsLeftRight,
            },
            {
              value: 'scroll',
              title: t('滚动'),
              detail: t('上下滑动，跟随自己的节奏'),
              Icon: MoveVertical,
            },
          ] as const
        ).map(({ value, title, detail, Icon }) => (
          <label key={value} className="reading-mode-option" data-active={mode === value}>
            <input
              type="radio"
              name="reader-navigation-mode"
              value={value}
              checked={mode === value}
              onChange={() => onChange(value)}
            />
            <span className="reading-mode-icon">
              <Icon size={22} strokeWidth={1.5} />
            </span>
            <span className="reading-mode-title">
              {title}
              {mode === value && <Check size={13} />}
            </span>
            <span className="reading-mode-detail">{detail}</span>
          </label>
        ))}
      </div>
      <p>
        {mode === 'paged'
          ? t('左右轻扫或用方向键翻页；长按仍可选文。每屏保留两行衔接。')
          : t('自然滚动，阅读位置自动保存。也可用方向键或空格向下翻一屏。')}
      </p>
    </fieldset>
  );
}

export function ReadingNavigation({
  mode,
  page,
  pages,
  atStart,
  atEnd,
  chapterIndex,
  chapterCount,
  turning,
  onTurn,
  onContents,
  onMode,
  progress,
}: {
  mode: Settings['navigationMode'];
  page: number;
  pages: number;
  atStart: boolean;
  atEnd: boolean;
  chapterIndex: number;
  chapterCount: number;
  turning: boolean;
  progress: number;
  onTurn: (direction: -1 | 1) => void;
  onContents: () => void;
  onMode: () => void;
}) {
  const { t } = useI18n();
  const previous = atStart ? t('上一章末尾') : t('上一页');
  const next = atEnd
    ? chapterIndex === chapterCount - 1
      ? t('已到全书末尾')
      : t('下一章')
    : t('下一页');
  return (
    <nav
      dir="ltr"
      className="reading-navigation"
      data-navigation={mode}
      aria-label={t('翻页导航')}
      aria-busy={turning}
    >
      <Button
        variant="plain"
        size="plain"
        className="reading-nav-arrow"
        aria-label={previous}
        title={`${previous} · ←`}
        disabled={turning || (atStart && chapterIndex === 0)}
        onClick={() => onTurn(-1)}
      >
        <ArrowLeft size={17} />
        <span>{atStart ? t('上一章') : t('上一页')}</span>
      </Button>
      <button
        className="reading-nav-location"
        onClick={onContents}
        aria-label={t('打开目录，第 {value0} 章，共 {value1} 章，阅读进度 {value2}%', {
          value0: chapterIndex + 1,
          value1: chapterCount,
          value2: progress,
        })}
      >
        <span>{t('第 {number} 章', { number: chapterIndex + 1 })}</span>
        <span className="reading-nav-page" aria-live="polite" aria-atomic="true">
          {mode === 'paged'
            ? t('{value0} / {value1} 屏', { value0: page, value1: pages })
            : `${progress}%`}
        </span>
      </button>
      <Button
        variant="plain"
        size="plain"
        className="reading-nav-arrow"
        aria-label={next}
        title={`${next} · →`}
        disabled={turning || (atEnd && chapterIndex === chapterCount - 1)}
        onClick={() => onTurn(1)}
      >
        <span>
          {atEnd ? (chapterIndex === chapterCount - 1 ? t('读完了') : t('下一章')) : t('下一页')}
        </span>
        <ArrowRight size={17} />
      </Button>
      <button
        className="reading-nav-mode"
        onClick={onMode}
        aria-label={t('切换翻页或滚动阅读')}
        title={t('阅读方式')}
      >
        {mode === 'paged' ? <ChevronsLeftRight size={16} /> : <MoveVertical size={16} />}
      </button>
    </nav>
  );
}

export function ChapterEnding({
  chapter,
  next,
  previous,
  index,
  turning,
  onChapter,
  onContents,
  onFinish,
}: {
  chapter: Chapter;
  next?: Chapter;
  previous?: Chapter;
  index: number;
  turning: boolean;
  onChapter: (index: number) => void;
  onContents: () => void;
  onFinish: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="chapter-ending" aria-label={next ? t('本章结束') : t('全书结束')}>
      <div className="chapter-ending-divider">
        <span />
        {next ? <ArrowDown size={14} /> : <Check size={16} />}
        <span />
      </div>
      <p className="chapter-ending-eyebrow">{next ? t('本章结束') : t('全书结束')}</p>
      <p className="chapter-ending-title">{next ? t('故事继续') : t('合上书，也留一点回味。')}</p>
      {next ? (
        <button className="chapter-next" disabled={turning} onClick={() => onChapter(index + 1)}>
          <span>
            <span className="chapter-next-label">{t('下一章')}</span>
            <span className="chapter-next-title">{next.title}</span>
          </span>
          <span className="chapter-next-arrow">
            <ArrowRight size={21} strokeWidth={1.5} />
          </span>
        </button>
      ) : (
        <div className="chapter-finished">
          <p>{chapter.title}</p>
          <Button className="rounded-full px-7" onClick={onFinish}>
            {t('回到书架')}
            <ArrowRight size={16} />
          </Button>
        </div>
      )}
      <div className="chapter-ending-links">
        <button disabled={!previous || turning} onClick={() => onChapter(index - 1)}>
          <ArrowLeft size={14} />
          {t('上一章')}
        </button>
        <button onClick={onContents}>
          <List size={15} />
          {t('查看目录')}
        </button>
      </div>
    </section>
  );
}
