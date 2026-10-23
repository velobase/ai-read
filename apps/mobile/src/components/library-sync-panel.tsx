import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { useLibraryController } from '../library-controller';
import { accountRevision } from '../adapters/account';
import { deviceLibrary } from '../adapters/library-scope';
import { synchronizeLibrary, useLibrarySyncStatus } from '../adapters/library-sync';
import type { LibrarySyncFailure } from '../adapters/library-sync-status';
import {
  restoreLibraryRecovery,
  type RecoveryRestoreResult,
} from '../adapters/library-recovery-restore';
import {
  exportLibraryRecovery,
  listLibraryRecoveries,
  readLibraryRecovery,
  recoveryPortableLibrary,
  retryRejectedLibrarySyncEntries,
  type LibraryRecoverySummary,
  type LibraryRecoverySnapshot,
} from '../adapters/library-sync-storage';
import { Button, Sheet } from './ui';
import { RecoveryResultView, recoveryReason } from './recovery-details';

function failureText(error: LibrarySyncFailure, zh: boolean) {
  const messages: Record<LibrarySyncFailure['kind'], [string, string]> = {
    authentication: [
      '账号授权已失效。请返回本机书库，在账号页重新登录后再同步。',
      'Account authorization expired. Open the device library and sign in again in Account.',
    ],
    permission: [
      '服务未允许同步此账号书库。请在账号页检查登录账号与书库授权。',
      'The service did not allow this account library to sync. Check the account and library authorization in Account.',
    ],
    offline: [
      '无法连接同步服务。本机修改已保留。',
      'Could not connect to the sync service. Local changes are saved.',
    ],
    timeout: [
      '同步请求超时。本机修改已保留。',
      'The sync request timed out. Local changes are saved.',
    ],
    server: [
      '同步服务暂时不可用。本机修改已保留。',
      'The sync service is temporarily unavailable. Local changes are saved.',
    ],
    protocol: [
      '同步服务返回了不兼容的数据。请检查服务版本后重试。',
      'The sync service returned incompatible data. Check the server version before retrying.',
    ],
    rejected: [
      '部分修改被服务端拒绝，已保留在本机。',
      'Some changes were rejected by the service and kept locally.',
    ],
    storage: [
      '暂时无法读取或保存本机同步数据。请重试。',
      'Could not read or save local sync data. Please retry.',
    ],
  };
  return messages[error.kind][zh ? 0 : 1];
}

export function LibrarySyncPanel() {
  const library = useLibrary();
  const { blocked, switchTo } = useLibraryController();
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const { colors, preferences } = useApp();
  const zh = preferences.locale === 'zh-CN';
  const status = useLibrarySyncStatus(library);
  const [visible, setVisible] = useState(false);
  const [rows, setRows] = useState<LibraryRecoverySummary[]>([]);
  const [selected, setSelected] = useState<LibraryRecoverySnapshot | null>(null);
  const [restored, setRestored] = useState<RecoveryRestoreResult | null>(null);
  const [notesShown, setNotesShown] = useState(20);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadActive = useRef(false);
  const loadSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (blocked) operation.current?.abort();
  }, [blocked]);
  const load = async (append = false) => {
    if (append && loadActive.current) return;
    const ticket = ++loadSequence.current;
    loadActive.current = true;
    setLoading(true);
    library.assertCurrent();
    const last = append ? rows.at(-1) : undefined;
    if (!append) {
      setRows([]);
      setMore(false);
    }
    try {
      const next = await listLibraryRecoveries(library.handle, {
        limit: 20,
        ...(last ? { before: last } : {}),
      });
      library.assertCurrent();
      if (!mounted.current || blockedRef.current || ticket !== loadSequence.current) return;
      setRows((current) => (append ? [...current, ...next] : next));
      setMore(next.length === 20);
    } finally {
      if (ticket === loadSequence.current) {
        loadActive.current = false;
        if (mounted.current && library.isCurrent()) setLoading(false);
      }
    }
  };
  useEffect(() => {
    if (visible)
      void load().catch(() => {
        if (library.isCurrent())
          setMessage(zh ? '暂时无法读取恢复副本。' : 'Could not read recovery copies.');
      });
  }, [visible, library, zh]);
  if (library.handle.kind !== 'account') return null;
  const action = async (work: (check: () => void, signal: AbortSignal) => Promise<void>) => {
    if (active.current || !mounted.current || blockedRef.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const revision = accountRevision();
    const check = () => {
      library.assertCurrent();
      if (
        !mounted.current ||
        blockedRef.current ||
        controller.signal.aborted ||
        revision !== accountRevision()
      )
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    };
    active.current = true;
    setBusy(true);
    setMessage('');
    try {
      check();
      await work(check, controller.signal);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && library.isCurrent())
        setMessage(
          error instanceof Error && error.message === 'library_recovery_too_large'
            ? zh
              ? '归档超过 50 MB，无法分享为可重新导入的文件。可先尝试导出阅读包。'
              : 'The archive exceeds the 50 MB import limit. Try exporting the reading pack.'
            : error instanceof Error && error.message === 'library_recovery_copy_removed'
              ? zh
                ? '此归档的本机恢复副本已被删除。原归档仍保留，可导出阅读包后重新导入。'
                : 'The previously restored device copy was deleted. The archive is preserved; export and import its reading pack to recover it again.'
              : zh
                ? '操作未完成，保存的数据仍保留。请稍后重试。'
                : 'Could not finish. Saved data is preserved; please retry.',
        );
    } finally {
      active.current = false;
      if (operation.current === controller) operation.current = null;
      if (mounted.current && library.isCurrent()) setBusy(false);
    }
  };
  const share = async (snapshot: LibraryRecoverySnapshot, portable: boolean, check: () => void) => {
    check();
    if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
    check();
    const json = portable
      ? JSON.stringify(recoveryPortableLibrary(snapshot), null, 2)
      : (await exportLibraryRecovery(library.handle, snapshot.id)).json;
    check();
    if (new TextEncoder().encode(json).byteLength > 50 * 1024 * 1024)
      throw new Error('library_recovery_too_large');
    const directory = new Directory(Paths.cache, 'bypage-exports', library.handle.attachmentScope);
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(
      directory,
      `LeafRead-${portable ? 'reading-pack' : 'recovery'}-${Crypto.randomUUID()}.json`,
    );
    try {
      file.create();
      file.write(json);
      check();
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        UTI: 'public.json',
        dialogTitle: 'LeafRead',
      });
    } finally {
      try {
        if (file.exists) file.delete();
      } catch {
        /* Private cache is disposable. */
      }
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <Text
        style={{ color: status.state === 'error' ? colors.error : colors.muted, lineHeight: 22 }}
      >
        {status.state === 'syncing'
          ? zh
            ? '正在同步账号书库…'
            : 'Syncing account library…'
          : status.state === 'error'
            ? status.error
              ? failureText(status.error, zh)
              : zh
                ? '同步暂未完成，本机修改已保留。'
                : 'Sync could not finish. Local changes are saved.'
            : status.completedAt
              ? (zh ? '上次同步：' : 'Last synced: ') +
                new Date(status.completedAt).toLocaleTimeString(preferences.locale)
              : zh
                ? '等待同步账号书库'
                : 'Waiting to sync'}
        {status.countsState === 'ready' && status.pending > 0
          ? zh
            ? ` · ${status.pending} 条待同步`
            : ` · ${status.pending} pending`
          : ''}
      </Text>
      {status.countsState === 'error' && (
        <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
          {zh ? '暂时无法读取待同步数量。' : 'Could not read pending changes.'}
        </Text>
      )}
      {status.state === 'error' && status.error?.retryable && status.retryAt && (
        <Text style={{ color: colors.muted, lineHeight: 22 }}>
          {(zh ? '保持应用前台时，将在此时间后重试：' : 'While the app is active, retry after: ') +
            new Date(status.retryAt).toLocaleTimeString(preferences.locale)}
        </Text>
      )}
      {status.countsState === 'ready' && status.blocked > 0 && (
        <Text style={{ color: colors.error, lineHeight: 22 }}>
          {zh
            ? `${status.blocked} 条修改被服务端拒绝，已留在本机。修改内容或点击重试后再发送。`
            : `${status.blocked} changes were rejected and kept locally. Edit them or retry explicitly.`}
        </Text>
      )}
      <Button
        secondary
        busy={busy || status.state === 'syncing'}
        disabled={busy || status.state === 'syncing'}
        onPress={() =>
          void action(async (check, signal) => {
            check();
            await retryRejectedLibrarySyncEntries(library.handle, {
              signal,
              isCurrent: () => {
                try {
                  check();
                  return true;
                } catch {
                  return false;
                }
              },
            });
            check();
            await synchronizeLibrary(library, { signal });
          })
        }
      >
        {status.state === 'error' || status.blocked > 0
          ? zh
            ? '重试同步'
            : 'Retry sync'
          : zh
            ? '立即同步'
            : 'Sync now'}
      </Button>
      <Button
        secondary
        disabled={busy}
        onPress={() => {
          setSelected(null);
          setRestored(null);
          setMessage('');
          setVisible(true);
        }}
      >
        {zh ? '恢复副本' : 'Recovery copies'}
      </Button>
      <Sheet
        visible={visible}
        title={zh ? '恢复副本' : 'Recovery copies'}
        close={() => {
          if (!busy) setVisible(false);
        }}
      >
        <Text style={{ color: colors.muted, lineHeight: 22 }}>
          {zh
            ? '这里保留同步冲突或删除前的数据。可恢复为独立的本机副本；原归档和现有书库都将保留。'
            : 'Data from before conflicts and deletions is preserved here. Restore an independent device copy while keeping the archive and existing library.'}
        </Text>
        <ScrollView
          style={{ maxHeight: 380 }}
          contentContainerStyle={{ gap: 14, paddingVertical: 14 }}
        >
          {restored ? (
            <>
              <RecoveryResultView result={restored} />
              <Button
                disabled={busy}
                onPress={() =>
                  void action(async (check) => {
                    check();
                    await switchTo(deviceLibrary);
                  })
                }
              >
                {zh ? '打开本机书库' : 'Open device library'}
              </Button>
              <Button
                secondary
                disabled={busy}
                onPress={() => {
                  setRestored(null);
                  setSelected(null);
                }}
              >
                {zh ? '返回恢复列表' : 'Back to recovery list'}
              </Button>
            </>
          ) : selected ? (
            <>
              <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '600' }}>
                {selected.title}
              </Text>
              <Text style={{ color: colors.muted }}>
                {recoveryReason(selected.reason, zh)} ·{' '}
                {new Date(selected.createdAt).toLocaleString(preferences.locale)}
              </Text>
              <Button
                disabled={busy}
                busy={busy}
                onPress={() => {
                  const snapshot = selected;
                  const revision = accountRevision();
                  Alert.alert(
                    zh ? '恢复到本机书库' : 'Restore to device library',
                    zh
                      ? `将“${snapshot.title}”恢复为独立副本，包含笔记、书签、进度、译文及兼容的 AI 历史和草稿。不会重新上传，原归档继续保留。`
                      : `Restore “${snapshot.title}” as an independent copy with notes, bookmarks, progress, translations and compatible AI history and drafts. It will not upload; the archive is kept.`,
                    [
                      { text: zh ? '取消' : 'Cancel', style: 'cancel' },
                      {
                        text: zh ? '恢复副本' : 'Restore copy',
                        onPress: () => {
                          if (revision !== accountRevision()) return;
                          void action(async (check, signal) => {
                            const result = await restoreLibraryRecovery(library, snapshot.id, {
                              signal,
                              isCurrent: () => {
                                try {
                                  check();
                                  return true;
                                } catch {
                                  return false;
                                }
                              },
                            });
                            check();
                            setRestored(result);
                          });
                        },
                      },
                    ],
                  );
                }}
              >
                {zh ? '恢复到本机书库' : 'Restore to device library'}
              </Button>
              <Text style={{ color: colors.ink }}>
                {zh
                  ? `笔记 ${selected.rows.notes.length} · 书签 ${selected.rows.bookmarks.length} · 译文语言 ${selected.rows.translations.length}`
                  : `${selected.rows.notes.length} notes · ${selected.rows.bookmarks.length} bookmarks · ${selected.rows.translations.length} translation languages`}
              </Text>
              {selected.rows.notes.slice(0, notesShown).map((row, index) => {
                const note = JSON.parse(String(row.body)) as { quote: string; text: string };
                return (
                  <View
                    key={index}
                    style={{ padding: 12, backgroundColor: colors.soft, borderRadius: 10, gap: 5 }}
                  >
                    <Text style={{ color: colors.muted }} numberOfLines={4}>
                      {note.quote}
                    </Text>
                    <Text selectable style={{ color: colors.ink }}>
                      {note.text}
                    </Text>
                  </View>
                );
              })}
              {selected.rows.notes.length > notesShown && (
                <Button
                  secondary
                  disabled={busy}
                  onPress={() => setNotesShown((value) => value + 20)}
                >
                  {zh
                    ? `更多笔记（已显示 ${notesShown} / ${selected.rows.notes.length}）`
                    : `More notes (${notesShown} of ${selected.rows.notes.length})`}
                </Button>
              )}
              <Text style={{ color: colors.muted, lineHeight: 22 }}>
                {zh
                  ? '阅读包包含书籍、笔记、书签、进度和已保存译文。完整归档还保存 AI 历史、草稿和待同步记录；两种文件都可从“导入”打开。恢复归档不会重放待同步操作。导出文件不包含 PDF 原件。'
                  : 'Reading packs include the book, notes, bookmarks, progress and saved translations. Complete archives also preserve AI history, drafts and pending records. Both open through Import; restoring an archive never replays pending operations. Exports do not include original PDFs.'}
              </Text>
              <Button
                secondary
                disabled={busy}
                onPress={() => void action((check) => share(selected, true, check))}
              >
                {zh ? '导出可导入的阅读包' : 'Export importable reading pack'}
              </Button>
              <Button
                secondary
                disabled={busy}
                onPress={() => void action((check) => share(selected, false, check))}
              >
                {zh ? '导出完整恢复归档' : 'Export complete recovery archive'}
              </Button>
              <Button secondary disabled={busy} onPress={() => setSelected(null)}>
                {zh ? '返回恢复列表' : 'Back to recovery list'}
              </Button>
            </>
          ) : (
            <>
              {loading && (
                <Text style={{ color: colors.muted }}>
                  {zh ? '正在读取恢复副本…' : 'Loading recovery copies…'}
                </Text>
              )}
              {!rows.length && !loading && (
                <Text style={{ color: colors.muted }}>
                  {zh ? '还没有恢复副本。' : 'No recovery copies yet.'}
                </Text>
              )}
              {rows.map((row) => (
                <Button
                  key={row.id}
                  secondary
                  disabled={busy}
                  onPress={() =>
                    void action(async (check) => {
                      const snapshot = await readLibraryRecovery(library.handle, row.id);
                      check();
                      if (!snapshot) throw new Error('recovery_missing');
                      setNotesShown(20);
                      setSelected(snapshot);
                    })
                  }
                >{`${row.title} · ${new Date(row.createdAt).toLocaleString(preferences.locale)}`}</Button>
              ))}
              {more && (
                <Button
                  secondary
                  disabled={busy || loading}
                  onPress={() => void action(() => load(true))}
                >
                  {zh ? '更早的副本' : 'Older copies'}
                </Button>
              )}
            </>
          )}
        </ScrollView>
        {!!message && (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {message}
          </Text>
        )}
      </Sheet>
      {!visible && !!message && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {message}
        </Text>
      )}
    </View>
  );
}
