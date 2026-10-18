'use client';

import { useI18n } from '@/lib/i18n/provider';

import { useRef, useState } from 'react';
import { Download, Upload, ShieldCheck, BookOpen, NotebookPen, HardDrive } from 'lucide-react';
import { useLibrary } from './library-provider';
import { LibraryShell, PageHeading, SettingsRow } from './library-ui';
import { storage } from '@/lib/storage';
import { validateBackup, type ReadingBackup } from '@/lib/reading-backup';
import { Modal } from '@/components/reader/reader-dialogs';
import { Button } from '@/components/ui/button';
import { useIdentity } from '@/components/auth/identity-provider';
import { SyncCard } from './sync-card';
import { readGuestLibrary } from '@/lib/guest-library';

export function DataPage() {
  const { t, locale } = useI18n();
  const { user } = useIdentity();
  const [fromGuest, setFromGuest] = useState(false);
  const { allBooks, notes, positions, refresh, notify } = useLibrary();
  const [pending, setPending] = useState<ReadingBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const exportData = () => {
    const backup: ReadingBackup = {
      format: 'ai-read-books-and-notes',
      version: 1,
      exportedAt: Date.now(),
      books: allBooks,
      notes,
      positions,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `LeafRead-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(t('阅读备份已导出。'));
  };
  const preview = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 60 * 1024 * 1024) throw new Error(t('备份文件超过 60 MB。'));
      setFromGuest(false);
      setPending(validateBackup(JSON.parse(await file.text())));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('无法读取备份文件。'));
    } finally {
      if (input.current) input.current.value = '';
    }
  };
  const restore = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await storage.restoreReadingBackup(pending);
      await refresh();
      setPending(null);
      notify(t('备份已恢复，已有书籍、笔记和阅读位置已保留。'));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('恢复失败。'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <LibraryShell hideNavigation>
      <main className="profile-page">
        <PageHeading title={t('数据与备份')} back="/me" />
        <SyncCard />
        <div className="settings-form-card">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck className="text-[#62ad97]" size={26} />
            <h2 className="font-medium">{t('安心保存在本机')}</h2>
          </div>
          <p className="text-sm leading-7 text-muted-foreground">
            {t(
              '书籍和笔记保存在当前浏览器。导出一份备份，可以在更换设备或清理浏览器之前，带走自己的阅读积累。',
            )}
          </p>
          <div className="mt-7 grid grid-cols-2 gap-5 border-t pt-6">
            <div>
              <BookOpen size={18} className="mb-3 text-muted-foreground" />
              <strong className="text-2xl font-medium">
                {allBooks.length.toLocaleString(locale)}
              </strong>
              <span className="ms-2 text-xs text-muted-foreground">{t('本书')}</span>
            </div>
            <div>
              <NotebookPen size={18} className="mb-3 text-muted-foreground" />
              <strong className="text-2xl font-medium">
                {notes.length.toLocaleString(locale)}
              </strong>
              <span className="ms-2 text-xs text-muted-foreground">{t('条笔记')}</span>
            </div>
          </div>
        </div>
        <div className="settings-group mt-5">
          {user && (
            <SettingsRow
              icon={<BookOpen size={22} className="text-[#81a896]" />}
              title={t('导入本机游客书库')}
              detail={t('保留游客原件')}
              onClick={() => {
                void readGuestLibrary()
                  .then((backup) => {
                    if (!backup.books.length) {
                      notify(t('这个浏览器还没有保存游客书籍。'));
                      return;
                    }
                    setFromGuest(true);
                    setPending(backup);
                  })
                  .catch(() => notify(t('无法读取游客书库，请稍后重试。')));
              }}
            />
          )}
          <SettingsRow
            icon={<Download size={22} className="text-primary" />}
            title={t('导出阅读备份')}
            detail={t('书籍、笔记、进度')}
            onClick={exportData}
          />
          <SettingsRow
            icon={<Upload size={22} className="text-[#81a896]" />}
            title={t('从备份恢复')}
            onClick={() => input.current?.click()}
          />
        </div>
        <div className="px-1 text-xs leading-7 text-muted-foreground">
          <p>
            {t(
              '备份包含已解析的书籍文字、封面、划线、想法与阅读位置，不包含 API Key、AI 对话或译文缓存。',
            )}
          </p>
          <p className="mt-3">
            {t('请保留原始 EPUB；同步与备份不包含原始文件、复杂排版或书内图片。')}
          </p>
        </div>
        <input
          ref={input}
          type="file"
          className="hidden"
          accept=".json,application/json"
          aria-label={t('选择阅读备份')}
          onChange={(e) => void preview(e.target.files?.[0])}
        />
        {pending && (
          <Modal
            title={fromGuest ? t('导入游客书库') : t('恢复阅读备份')}
            close={() => {
              if (!busy) setPending(null);
            }}
          >
            <p className="my-6 text-sm leading-8 text-muted-foreground">
              {t(
                '找到 {books} 本书、{notes} 条笔记。已有书籍与阅读位置不会被覆盖；笔记按 ID 合并，保留本机已有版本。',
                { books: pending.books.length, notes: pending.notes.length },
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
