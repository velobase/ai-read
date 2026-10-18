'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, ChevronDown } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { useIdentity } from '@/components/auth/identity-provider';
import { useBookTranslation } from '@/components/reader/use-book-translation';
import { TranslationPanel } from '@/components/reader/translation-panel';
import { applyAIConnection, readAIConnection } from '@/lib/ai-connection';
import { loadSettings, saveSettings, storage } from '@/lib/storage';
import { languages, type Book } from '@/lib/types';

export function BookTranslationCard({ book, chapter = 0 }: { book: Book; chapter?: number }) {
  const { locale } = useI18n();
  const zh = locale.startsWith('zh');
  const router = useRouter();
  const { enabled, user } = useIdentity();
  const [settings, setSettings] = useState(loadSettings);
  const [legacy, setLegacy] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let alive = true;
    void readAIConnection()
      .then((config) => {
        if (alive) setSettings((s) => applyAIConnection(s, config));
      })
      .catch(() => {});
    void storage
      .translations(book.id)
      .then((value) => {
        if (alive) setLegacy(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [book.id]);
  const controller = useBookTranslation(book, settings, {
    chapter,
    auto: false,
    enabled: true,
    legacy,
  });
  const count = controller.edition
    ? controller.edition.chapters.filter((c) => c.state === 'ready').length
    : controller.legacyCount;
  return (
    <section className="mb-8 rounded-2xl border border-border bg-background p-5">
      <button
        className="flex w-full items-center gap-3 text-start"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <BookOpen className="text-primary" size={21} />
        <span className="flex-1 text-sm font-medium">
          {zh ? '书籍译本' : 'Book translation'}
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {count
              ? zh
                ? `已准备 ${count} / ${book.chapters.length} 章`
                : `${count} / ${book.chapters.length} chapters ready`
              : zh
                ? '提前准备整本，阅读时不再等待'
                : 'Prepare your book before reading'}
          </span>
        </span>
        <ChevronDown size={17} className={expanded ? 'rotate-180' : ''} />
      </button>
      {expanded && (
        <div className="mt-5 border-t border-border pt-5">
          <label className="mb-5 flex items-center justify-between gap-4 text-xs">
            {zh ? '译文语言' : 'Translation language'}
            <select
              className="max-w-48 rounded-lg border border-border bg-background p-2"
              value={settings.language}
              onChange={(event) => {
                const next = { ...settings, language: event.target.value };
                setSettings(next);
                saveSettings(next);
              }}
            >
              {languages.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <TranslationPanel
            controller={controller}
            book={book}
            chapter={chapter}
            connect={() =>
              router.push(
                enabled && !user
                  ? `/login?returnTo=${encodeURIComponent(`/books/${book.id}`)}`
                  : '/me/models',
              )
            }
          />
        </div>
      )}
    </section>
  );
}
