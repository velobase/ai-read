'use client';
import { Cloud, Download, RefreshCw } from 'lucide-react';
import { useSync, syncNow } from '@/components/auth/sync-provider';
import { useIdentity } from '@/components/auth/identity-provider';
import { useI18n } from '@/lib/i18n/provider';
import { recoveryPortableLibrary } from '@/lib/sync-storage';
import { Button } from '@/components/ui/button';
import { useLibrary } from './library-provider';
export function SyncCard() {
  const { user } = useIdentity();
  const sync = useSync();
  const { t } = useI18n();
  const { notify } = useLibrary();
  if (!user) return null;
  const state = {
    local: '本机数据已保存。登录后可跨设备同步。',
    syncing: '同步中…',
    ready: '已同步',
    offline: '离线，修改已保存在本机',
    error: '同步暂不可用，本机数据已保留',
    auth: '登录后继续同步',
  } as const;
  const recover = async () => {
    try {
      const backup = await recoveryPortableLibrary();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `LeafRead-local-copy-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      notify(t('同步暂不可用，本机数据已保留'));
    }
  };
  return (
    <section className="settings-form-card mb-5" aria-label={t('云端同步')}>
      <div className="mb-4 flex items-center gap-3">
        <Cloud size={24} className="text-primary" />
        <h2 className="font-medium">{t('云端同步')}</h2>
      </div>
      <p className="text-sm leading-7 text-muted-foreground">
        {t('同一账号的书籍、笔记、进度、AI 对话和自动译文会在联网后同步。游客数据只保存在本机。')}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm">
          {sync.state === 'error' && sync.error === 'sync-invalid'
            ? t('{count} 条数据暂未同步，已保留在本机；其他数据继续同步。', {
                count: sync.blocked || 0,
              })
            : t(state[sync.state])}
        </p>
        <Button variant="outline" onClick={syncNow} disabled={sync.state === 'syncing'}>
          <RefreshCw size={16} className={sync.state === 'syncing' ? 'animate-spin' : ''} />
          {t('立即同步')}
        </Button>
      </div>
      {sync.recovered > 0 && (
        <Button className="mt-5" variant="outline" onClick={() => void recover()}>
          <Download size={16} />
          {t('导出同步前的本机副本')}
        </Button>
      )}
    </section>
  );
}
