'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BookOpen,
  LibraryBig,
  NotebookPen,
  UserRound,
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
  LoaderCircle,
} from 'lucide-react';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { BookDisplay } from '@/lib/types';
import { catalog } from '@/lib/catalog';
import { cn } from '@/lib/utils';
import { useLibrary } from './library-provider';
import { storageKey } from '@/lib/storage-scope';

const navigation = [
  { href: '/', name: '阅读', Icon: BookOpen },
  { href: '/library', name: '书架', Icon: LibraryBig },
  { href: '/notes', name: '笔记', Icon: NotebookPen },
  { href: '/me', name: '我', Icon: UserRound },
];

export function LibraryShell({
  children,
  hideNavigation = false,
}: {
  children: ReactNode;
  hideNavigation?: boolean;
}) {
  const { t, text: localize } = useI18n();
  const pathname = usePathname();
  const { ready, error, refresh } = useLibrary();
  useEffect(() => {
    document.documentElement.dataset.theme = 'paper';
    if (!ready) return;
    try {
      const key = storageKey(`ai-read-return:${window.location.pathname}${window.location.search}`);
      const saved = sessionStorage.getItem(key);
      if (saved === null) return;
      const frame = requestAnimationFrame(() => {
        window.scrollTo({ top: Number(saved) || 0 });
        sessionStorage.removeItem(key);
      });
      return () => cancelAnimationFrame(frame);
    } catch {
      /* Restoring scroll is optional when session storage is unavailable. */
    }
  }, [ready, pathname]);
  return (
    <div className="library-app">
      <header className="library-desktop-header">
        <Link href="/" className="flex items-center gap-2.5 font-semibold text-xl">
          {t('ByPage · 逐页')}
        </Link>
        <nav aria-label={t('主导航')} className="flex items-center gap-9">
          {navigation.map(({ href, name }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                pathname === href || (href !== '/' && pathname.startsWith(href))
                  ? 'page'
                  : undefined
              }
              className={cn(
                'desktop-nav-link',
                (pathname === href || (href !== '/' && pathname.startsWith(href))) && 'is-active',
              )}
            >
              {localize(name)}
            </Link>
          ))}
        </nav>
      </header>
      {!ready ? (
        <div
          className="flex min-h-[60vh] items-center justify-center gap-3 text-muted-foreground"
          role="status"
        >
          <LoaderCircle size={18} className="animate-spin" />
          {t('正在打开书架…')}
        </div>
      ) : error ? (
        <Empty title={t('暂时无法打开书架')} description={localize(error)}>
          <button className="library-primary" onClick={() => void refresh()}>
            {t('重试')}
          </button>
        </Empty>
      ) : (
        children
      )}
      {!hideNavigation && (
        <nav aria-label={t('手机主导航')} className="library-mobile-nav">
          {navigation.map(({ href, name, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                pathname === href || (href !== '/' && pathname.startsWith(href))
                  ? 'page'
                  : undefined
              }
              className={cn(
                'mobile-nav-link',
                (pathname === href || (href !== '/' && pathname.startsWith(href))) && 'is-active',
              )}
            >
              <Icon size={25} strokeWidth={1.7} />
              <span>{localize(name)}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

export function Avatar() {
  const { text: localize } = useI18n();
  const { profile } = useLibrary();
  const rawName = profile.name;
  const displayName = rawName === '读书的人' ? localize('读书的人') : rawName;
  return (
    <span
      className="reader-avatar"
      style={{ '--avatar-color': profile.color } as CSSProperties}
      aria-hidden="true"
    >
      <span>{displayName.trim().slice(0, 1).toUpperCase()}</span>
    </span>
  );
}

export function SearchBar({ className }: { className?: string }) {
  const { text: localize } = useI18n();
  const router = useRouter();
  return (
    <form
      role="search"
      className={cn('library-search', className)}
      onSubmit={(e) => {
        e.preventDefault();
        const q = String(new FormData(e.currentTarget).get('q') || '').trim();
        router.push(`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      }}
    >
      <Search size={20} className="shrink-0 text-muted-foreground" />
      <input
        name="q"
        aria-label={localize('搜索书名、作者、正文或笔记')}
        placeholder={localize('搜索书名、作者、正文或笔记')}
        autoComplete="off"
        enterKeyHint="search"
        maxLength={160}
      />
    </form>
  );
}

export function PageHeading({
  title,
  back,
  children,
}: {
  title: string;
  back?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="library-page-heading">
      <div className="flex min-w-0 items-center gap-2">
        {back && (
          <Link
            href={back}
            aria-label={t('返回')}
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-black/5"
          >
            <ChevronLeft size={25} />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold sm:text-[26px]">{title}</h1>
        </div>
      </div>
      {children && <div className="flex shrink-0 items-center gap-3">{children}</div>}
    </header>
  );
}

export function BookCover({ book }: { book: BookDisplay }) {
  const { t, locale } = useI18n();
  const known = catalog.findIndex((b) => b.id === book.id);
  const variant =
    known >= 0 ? known : Array.from(book.id).reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  const isChineseUi = locale.startsWith('zh');
  const authorLabel = book.sample
    ? book.id === 'ai-read-original-demo-v1'
      ? isChineseUi
        ? locale === 'zh-TW'
          ? '原創示例'
          : '原创示例'
        : 'Original sample'
      : isChineseUi
        ? locale === 'zh-TW'
          ? '原創短文'
          : '原创短文'
        : 'Original essay'
    : book.author.replace(/^(ByPage · 逐页|LeafRead|叶读|葉讀|逐页|逐頁) · /, '');
  return (
    <div className={cn('library-book-cover', `cover-style-${variant}`)}>
      {book.cover &&
      (/^data:image\/(png|jpeg|webp);base64,/.test(book.cover) ||
        /^\/api\/catalog\/[a-z0-9-]+\/cover$/.test(book.cover)) ? (
        <img
          src={book.cover}
          alt={t('{value0}封面', { value0: book.title })}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <>
          <div
            className="cover-lettering"
            style={
              {
                '--cover-title-size': `${book.title.length > 40 ? 11 : book.title.length > 22 ? 14 : 18}cqw`,
              } as CSSProperties
            }
          >
            <strong>{book.title}</strong>
            {book.subtitle && <span className="cover-subtitle">{book.subtitle}</span>}
            <span className="cover-author">{authorLabel}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function BookCard({ book, onClick }: { book: BookDisplay; onClick: () => void }) {
  return (
    <button className="book-card block w-full text-start" onClick={onClick}>
      <BookCover book={book} />
      <span className="mt-3 line-clamp-2 text-[13px] leading-snug font-medium sm:text-[15px]">
        {book.title}
      </span>
    </button>
  );
}

export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="library-empty">
      <h2 className="text-lg font-medium">{title}</h2>
      {description && (
        <p className="mt-3 max-w-sm text-center text-sm leading-7 text-muted-foreground">
          {description}
        </p>
      )}
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}

export function SettingsRow({
  title,
  detail,
  href,
  onClick,
}: {
  title: string;
  detail?: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="flex-1">{title}</span>
      {detail && (
        <span className="max-w-[45%] truncate text-sm text-muted-foreground">{detail}</span>
      )}
      {href && <ChevronRight size={17} className="text-muted-foreground/60" />}
    </>
  );
  return href ? (
    <Link href={href} className="settings-row">
      {content}
    </Link>
  ) : (
    <button onClick={onClick} className="settings-row">
      {content}
    </button>
  );
}

export function ImportButton() {
  const { t } = useI18n();
  const { openImport } = useLibrary();
  return (
    <button
      onClick={openImport}
      className="flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
    >
      <Plus size={18} />
      {t('导入')}
    </button>
  );
}
