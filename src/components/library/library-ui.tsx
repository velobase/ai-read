'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { LanguageMenu } from './language-menu';
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
import { useIdentity } from '@/components/auth/identity-provider';

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
  const { user } = useIdentity();
  const { profile, ready, error, refresh, openImport } = useLibrary();
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
          <span className="brand-mark">
            <BookOpen size={21} strokeWidth={1.8} />
          </span>
          {t('ByPage · 逐页')}
        </Link>
        <nav aria-label={t('主导航')} className="flex items-center gap-9">
          {navigation.slice(0, 3).map(({ href, name }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'desktop-nav-link',
                (pathname === href || (href !== '/' && pathname.startsWith(href))) && 'is-active',
              )}
            >
              {localize(name)}
            </Link>
          ))}
          <button
            onClick={openImport}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-primary/10 px-3.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          >
            <Plus size={14} />
            {t('导入书籍')}
          </button>
          <LanguageMenu />
          <Link href="/me" className="flex items-center gap-2 text-sm">
            <Avatar small />
            <span className="max-w-28 truncate">{user ? profile.name : t('游客阅读')}</span>
          </Link>
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

export function Avatar({
  small = false,
  color,
  name,
}: {
  small?: boolean;
  color?: string;
  name?: string;
}) {
  const { text: localize } = useI18n();
  const { profile } = useLibrary();
  const rawName = name || profile.name;
  const displayName = rawName === '读书的人' ? localize('读书的人') : rawName;
  return (
    <span
      className={cn('reader-avatar', small && 'reader-avatar-small')}
      style={{ '--avatar-color': color || profile.color } as CSSProperties}
      aria-hidden="true"
    >
      <span>{displayName.trim().slice(0, 1).toUpperCase()}</span>
      <i />
      <b />
    </span>
  );
}

export function SearchBar({
  large = false,
  className,
  placeholder = '搜索书名、作者或笔记',
  defaultValue = '',
}: {
  large?: boolean;
  className?: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  const { t, text: localize } = useI18n();
  const router = useRouter();
  return (
    <form
      role="search"
      className={cn('library-search', large && 'library-search-large', className)}
      onSubmit={(e) => {
        e.preventDefault();
        const q = String(new FormData(e.currentTarget).get('q') || '').trim();
        router.push(`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      }}
    >
      <Search size={20} className="shrink-0 text-muted-foreground" />
      <input
        name="q"
        aria-label={t('搜索书名、作者或笔记')}
        defaultValue={defaultValue}
        placeholder={localize(placeholder)}
        autoComplete="off"
        maxLength={160}
      />
      <Link
        href="/discover"
        className="shrink-0 border-s border-black/10 ps-3 text-sm text-foreground/80"
      >
        {t('书城')}
      </Link>
    </form>
  );
}

export function PageHeading({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
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
          {subtitle && <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </header>
  );
}

export function BookCover({ book, className }: { book: BookDisplay; className?: string }) {
  const { t, locale } = useI18n();
  const known = catalog.findIndex((b) => b.id === book.id);
  const variant =
    known >= 0 ? known : Array.from(book.id).reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  const isChineseUi = locale.startsWith('zh');
  const kicker = book.sample
    ? isChineseUi
      ? locale === 'zh-TW'
        ? '葉讀原創'
        : '叶读原创'
      : 'LEAFREAD ORIGINALS'
    : book.listingOnly
      ? t('英文原版')
      : book.language.toUpperCase();
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
    <div className={cn('library-book-cover', `cover-style-${variant}`, className)}>
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
          <div className="cover-geometry" aria-hidden="true">
            <i />
            <b />
          </div>
          <div
            className="cover-lettering"
            style={
              {
                '--cover-title-size': `${book.title.length > 40 ? 11 : book.title.length > 22 ? 14 : 18}cqw`,
              } as CSSProperties
            }
          >
            <span className="cover-kicker">{kicker}</span>
            <strong>{book.title}</strong>
            {book.subtitle && <span className="cover-subtitle">{book.subtitle}</span>}
            <span className="cover-author">{authorLabel}</span>
          </div>
          <span className="cover-imprint">{book.publisher || t('ByPage · 逐页')}</span>
        </>
      )}
    </div>
  );
}

export function BookCard({
  book,
  showAuthor = false,
  onClick,
  children,
}: {
  book: BookDisplay;
  showAuthor?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const isChineseUi = locale.startsWith('zh');
  const displayAuthor = book.sample
    ? `${t('ByPage · 逐页')} · ${
        book.id === 'ai-read-original-demo-v1'
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
      }`
    : book.author.replace(/^(ByPage · 逐页|逐页|逐頁|叶读|葉讀|LeafRead)/, t('ByPage · 逐页'));
  const inner = (
    <>
      <BookCover book={book} />
      <span className="mt-3 line-clamp-2 text-[13px] leading-snug font-medium sm:text-[15px]">
        {book.title}
      </span>
      {showAuthor && (
        <span className="mt-1.5 block truncate text-xs text-muted-foreground">{displayAuthor}</span>
      )}
      {book.listingOnly && (
        <span className="mt-2 block text-[11px] leading-5 text-muted-foreground">
          {t('英文原版 · 书目推荐')}
        </span>
      )}
    </>
  );
  return (
    <div className="book-card">
      {onClick ? (
        <button className="block w-full text-start" onClick={onClick}>
          {inner}
        </button>
      ) : (
        <Link href={`/books/${book.id}`} className="block">
          {inner}
        </Link>
      )}
      {children}
    </div>
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
      <span className="mb-5 flex size-16 items-center justify-center rounded-full bg-white text-[#b5bdc7]">
        <BookOpen size={29} strokeWidth={1.3} />
      </span>
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
  icon,
  title,
  detail,
  href,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="shrink-0">{icon}</span>
      <span className="flex-1">{title}</span>
      {detail && (
        <span className="max-w-[45%] truncate text-sm text-muted-foreground">{detail}</span>
      )}
      <ChevronRight size={17} className="text-muted-foreground/60" />
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
