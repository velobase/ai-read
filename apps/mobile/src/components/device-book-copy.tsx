import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { accountSnapshot } from '../adapters/account';
import { exportLibrary, importLibrary, listBooks, type ShelfBook } from '../adapters/database';
import { deviceLibrary } from '../adapters/library-scope';
import { Button, Sheet } from './ui';

/** Selecting a book is the explicit boundary between device data and cloud-bound data. */
export function DeviceBookCopy() {
  const { colors, preferences } = useApp();
  const zh = preferences.locale === 'zh-CN';
  const library = useLibrary();
  const [visible, setVisible] = useState(false);
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    void listBooks(deviceLibrary)
      .then((value) => {
        if (live && library.isCurrent()) setBooks(value);
      })
      .catch(() => {
        if (live) setMessage(zh ? '无法读取本机书库。' : 'Could not read the device library.');
      });
    return () => {
      live = false;
    };
  }, [visible, library, zh]);
  if (library.handle.kind !== 'account') return null;
  const copy = async (book: ShelfBook) => {
    if (
      !mounted.current ||
      active.current ||
      !library.isCurrent() ||
      library.handle.kind !== 'account'
    )
      return;
    const destination = library.handle;
    const identity = accountSnapshot();
    const check = () => {
      library.assertCurrent();
      if (!mounted.current) throw new Error('cancelled');
      const now = accountSnapshot();
      if (
        now.revision !== identity.revision ||
        now.session?.user.id !== destination.userId ||
        now.origin !== destination.origin ||
        !now.session?.permissions.includes('library_sync')
      )
        throw new Error('account_changed');
    };
    active.current = true;
    setBusy(true);
    setMessage('');
    try {
      check();
      const pack = await exportLibrary(deviceLibrary, book.id);
      check();
      await importLibrary(library.handle, pack);
      if (library.isCurrent())
        setMessage(
          zh
            ? `已复制《${book.title}》，等待账号同步；同 ID 的已有数据保留。`
            : `Copied “${book.title}”; waiting to sync. Existing records with the same IDs were preserved.`,
        );
    } catch {
      if (library.isCurrent())
        setMessage(
          zh
            ? '复制未完成。可能存在不同版本的同名 ID；本机原书仍保留。'
            : 'Copy did not complete. A different edition may share this ID. The device original is preserved.',
        );
    } finally {
      active.current = false;
      if (library.isCurrent()) setBusy(false);
    }
  };
  return (
    <>
      <Button
        secondary
        onPress={() => {
          setMessage('');
          setVisible(true);
        }}
      >
        {zh ? '从本机选择书籍复制' : 'Copy selected device books'}
      </Button>
      <Sheet
        visible={visible}
        title={zh ? '复制到账号书库' : 'Copy to account library'}
        close={() => {
          if (!busy) setVisible(false);
        }}
      >
        <Text style={{ color: colors.muted, lineHeight: 22 }}>
          {zh
            ? '只复制你选择的书籍、笔记、书签和进度，并同步到当前账号。本机原书保留。译文仅复制到本机账号缓存；PDF 原件和 AI 历史不复制。'
            : 'Only selected books, notes, bookmarks and progress will be copied and synced to this account. Device originals remain. Translations are copied to the local account cache only; PDF originals and AI history are not copied.'}
        </Text>
        <ScrollView
          style={{ maxHeight: 360 }}
          contentContainerStyle={{ gap: 12, paddingVertical: 14 }}
        >
          {books.map((book) => (
            <View key={book.id} style={{ gap: 6 }}>
              <Text style={{ color: colors.ink, fontWeight: '600' }}>{book.title}</Text>
              <Button
                secondary
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    zh ? '复制并同步这本书？' : 'Copy and sync this book?',
                    `${book.title}\n${accountSnapshot().session?.user.email || ''}\n${library.handle.kind === 'account' ? library.handle.origin : ''}`,
                    [
                      { text: zh ? '取消' : 'Cancel', style: 'cancel' },
                      { text: zh ? '复制' : 'Copy', onPress: () => void copy(book) },
                    ],
                  )
                }
              >
                {zh ? '选择这本书' : 'Select this book'}
              </Button>
            </View>
          ))}
        </ScrollView>
        {busy && <Text style={{ color: colors.muted }}>{zh ? '正在保存…' : 'Saving…'}</Text>}
        {!!message && (
          <Text accessibilityRole="alert" style={{ color: colors.ink }}>
            {message}
          </Text>
        )}
      </Sheet>
    </>
  );
}
