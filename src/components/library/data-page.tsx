'use client';

import { useI18n } from '@/lib/i18n/provider';

import { useEffect, useRef, useState } from 'react';
import { useLibrary } from './library-provider';
import { LibraryShell, PageHeading, SettingsRow } from './library-ui';
import { storage } from '@/lib/storage';
import { validateBackup, type ReadingBackup } from '@/lib/reading-backup';
import {
  createPortableLibrary,
  downloadPortableLibrary,
  validatePortableLibrary,
  type PortableTranslation,
  type PortableCollection,
  type PortableLibrary,
} from '@/lib/portable-library';
import { Modal } from '@/components/reader/reader-dialogs';
import { Button } from '@/components/ui/button';
import { useIdentity } from '@/components/auth/identity-provider';
import { SyncCard } from './sync-card';
import { readGuestLibrary } from '@/lib/guest-library';
import { resumePortableCollections } from '@/lib/library-state';

export function DataPage() {
  const { t, text: localize } = useI18n();
  const { user } = useIdentity();
  const [fromGuest, setFromGuest] = useState(false);
  const { allBooks, notes, bookmarks, positions, refresh, notify } = useLibrary();
  const [pending, setPending] = useState<ReadingBackup | null>(null);
  const [portable, setPortable] = useState<PortableLibrary | null>(null);
  const [translations, setTranslations] = useState<PortableTranslation[]>([]);
  const [collections, setCollections] = useState<PortableCollection[] | undefined>();
  const [collectionsPending, setCollectionsPending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void resumePortableCollections().then((result) => {
      if (mounted.current) setCollectionsPending(result.collectionsPending);
    });
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  const exportData = () => {
    const backup: ReadingBackup = {
      format: 'ai-read-books-and-notes',
      version: 1,
      exportedAt: Date.now(),
      books: allBooks,
      notes,
      bookmarks,
      positions,
    };
    let payload: string;
    try {
      payload = JSON.stringify(validateBackup(backup));
    } catch (error) {
      notify(error instanceof Error ? localize(error.message) : t('导出失败，请重试。'));
      return;
    }
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `LeafRead-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(t('阅读备份已导出。'));
  };
  const exportMobile = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      downloadPortableLibrary(
        await createPortableLibrary(
          {
            format: 'ai-read-books-and-notes',
            version: 1,
            exportedAt: Date.now(),
            books: allBooks,
            notes,
            bookmarks,
            positions,
          },
          { includeEmptyCollections: true },
        ),
      );
      notify(t('阅读包已导出，可在 iOS App 中导入。'));
    } catch (error) {
      notify(error instanceof Error ? localize(error.message) : t('导出失败，请重试。'));
    } finally {
      setExporting(false);
    }
  };
  const preview = async (file?: File) => {
    if (!file || busyRef.current) return;
    const token = ++request.current;
    try {
      if (file.size > 60 * 1024 * 1024) throw new Error(t('备份文件超过 60 MB。'));
      setFromGuest(false);
      const pack = validatePortableLibrary(JSON.parse(await file.text()));
      if (!mounted.current || token !== request.current || busyRef.current) return;
      setTranslations(pack.translations);
      setPortable(pack);
      setCollections(pack.collections);
      setPending(pack.backup);
    } catch (error) {
      if (mounted.current && token === request.current)
        notify(error instanceof Error ? localize(error.message) : t('无法读取备份文件。'));
    } finally {
      if (input.current) input.current.value = '';
    }
  };
  const restore = async () => {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    request.current++;
    setBusy(true);
    try {
      const result = portable
        ? await storage.restorePortableLibrary(portable)
        : await storage.restoreReadingBackup(pending, translations, collections);
      if (!mounted.current) return;
      setPending(null);
      setPortable(null);
      setCollections(undefined);
      setCollectionsPending(result.collectionsPending);
      notify(
        t(
          result.collectionsPending
            ? '书籍已导入，分组尚未整理完成。请重试分组整理。'
            : '备份已恢复，已有书籍、笔记和阅读位置已保留。',
        ),
      );
      // Refresh errors cannot turn a committed import into a failed import.
      await refresh().catch(() => {});
    } catch (error) {
      if (mounted.current)
        notify(error instanceof Error ? localize(error.message) : t('恢复失败。'));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const retryCollections = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await resumePortableCollections();
      if (!mounted.current) return;
      setCollectionsPending(result.collectionsPending);
      if (!result.collectionsPending) notify(t('分组整理已完成。'));
      await refresh().catch(() => {});
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <LibraryShell hideNavigation>
      <main className="profile-page">
        <PageHeading title={t('数据与备份')} back="/me" />
        <SyncCard />
        {collectionsPending && (
          <section className="settings-form-card mb-5" role="status">
            <p className="text-sm leading-7">
              {t('书籍已导入，分组尚未整理完成。请重试分组整理。')}
            </p>
            <Button
              className="mt-4"
              variant="outline"
              disabled={busy}
              onClick={() => void retryCollections()}
            >
              {t('重试分组整理')}
            </Button>
          </section>
        )}
        <div className="settings-group mt-5">
          {user && (
            <SettingsRow
              title={t('导入本机游客书库')}
              detail={t('保留游客原件')}
              onClick={() => {
                if (busyRef.current) return;
                const token = ++request.current;
                void readGuestLibrary()
                  .then((backup) => {
                    if (!mounted.current || token !== request.current || busyRef.current) return;
                    if (!backup.books.length) {
                      notify(t('这个浏览器还没有保存游客书籍。'));
                      return;
                    }
                    setFromGuest(true);
                    setPortable(null);
                    setTranslations([]);
                    setCollections(undefined);
                    setPending(backup);
                  })
                  .catch(() => notify(t('无法读取游客书库，请稍后重试。')));
              }}
            />
          )}
          <SettingsRow
            title={t('导出阅读备份')}
            detail={t('书籍、笔记、进度')}
            onClick={exportData}
          />
          <SettingsRow
            title={t(exporting ? '正在导出阅读包…' : '导出 iOS 阅读包')}
            detail={t('含已保存的译文和分组')}
            onClick={() => void exportMobile()}
          />
          <SettingsRow
            title={t('从备份恢复')}
            onClick={() => {
              if (!busyRef.current) input.current?.click();
            }}
          />
        </div>
        <details className="px-1 text-xs leading-7 text-muted-foreground">
          <summary className="cursor-pointer py-3">{t('备份内容')}</summary>
          <p>
            {t(
              '备份包含已解析的书籍文字、封面、划线、想法与阅读位置，不包含 API Key、AI 对话或译文缓存。',
            )}
          </p>
          <p className="mt-3">
            {t(
              'iOS 阅读包额外包含已下载的译文，可通过 AirDrop 或“文件”导入 App；也支持将 App 阅读包导回网页。',
            )}
          </p>
          <p className="mt-3">
            {t('阅读包与同步可携带已解析的插图；复杂版面、行内图片和原始文件仍需保留原书。')}
          </p>
          <p className="mt-3">{t('全库阅读包保留空分组；单本阅读包只包含这本书所在的分组。')}</p>
        </details>
        <input
          ref={input}
          type="file"
          disabled={busy}
          className="hidden"
          accept=".json,application/json"
          aria-label={t('选择阅读备份')}
          onChange={(e) => void preview(e.target.files?.[0])}
        />
        {pending && (
          <Modal
            title={fromGuest ? t('导入游客书库') : t('恢复阅读备份')}
            close={() => {
              if (!busyRef.current) setPending(null);
            }}
          >
            <p className="my-6 text-sm leading-8 text-muted-foreground">
              {t(
                '找到 {books} 本书、{notes} 条笔记。已有书籍与阅读位置不会被覆盖；笔记按 ID 合并，保留本机已有版本。',
                { books: pending.books.length, notes: pending.notes.length },
              )}
              <br />
              {t('书签 {count} 条', { count: pending.bookmarks?.length || 0 })}
              {portable?.version === 2 && (
                <>
                  <br />
                  {t(
                    '精确译文版本 {versions} 条，选版 {selections} 条；同键冲突会停止导入，不覆盖本机译文。',
                    {
                      versions: portable.translationVersions.length,
                      selections: portable.translationSelections.length,
                    },
                  )}
                </>
              )}
              {collections !== undefined && (
                <>
                  <br />
                  {t('分组 {count} 个；同名分组合并，已有书籍归属以本机为准。', {
                    count: collections.length,
                  })}
                </>
              )}
              {fromGuest && t('将复制到当前账号并同步，游客原件保留。')}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                {t('取消')}
              </Button>
              <Button disabled={busy} onClick={() => void restore()}>
                {busy ? t('正在保存…') : fromGuest ? t('导入到当前账号') : t('恢复备份')}
              </Button>
            </div>
          </Modal>
        )}
      </main>
    </LibraryShell>
  );
}
