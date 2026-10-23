import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import {
  createCollection,
  listCollections,
  moveBooksToCollection,
  removeCollection,
  renameCollection,
  subscribeCollections,
  type CollectionSnapshot,
  type ShelfCollection,
} from '../adapters/collections';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import type { LibraryLease } from '../adapters/library-scope';
import type { TextKey } from '../i18n';
import { Button, Icon, IconButton, Sheet, styles } from './ui';

export function collectionErrorKey(error: unknown): TextKey {
  switch (error instanceof Error ? error.message : '') {
    case 'collection_name':
      return 'collectionsNameError';
    case 'collection_duplicate':
      return 'collectionsDuplicate';
    case 'collection_limit':
      return 'collectionsLimit';
    case 'collection_missing':
      return 'collectionsMissing';
    case 'book_missing':
      return 'collectionsBookMissing';
    default:
      return 'error';
  }
}

/** The latest request wins when a book deletion and a collection event overlap. */
export function useCollectionSnapshot(active = true) {
  const library = useLibrary();
  const [loaded, setLoaded] = useState<{
    library: LibraryLease;
    snapshot: CollectionSnapshot;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const alive = useRef(false);
  const refresh = useCallback(async () => {
    if (!alive.current || !library.isCurrent()) return false;
    const token = ++request.current;
    setLoading(true);
    setFailed(false);
    try {
      const value = await listCollections(library.handle);
      if (!library.isCurrent()) return false;
      if (alive.current && request.current === token) setLoaded({ library, snapshot: value });
      return true;
    } catch {
      if (library.isCurrent() && alive.current && request.current === token) setFailed(true);
      return false;
    } finally {
      if (library.isCurrent() && alive.current && request.current === token) setLoading(false);
    }
  }, [library]);
  useEffect(() => {
    alive.current = active && library.isCurrent();
    if (!alive.current) return;
    void refresh();
    const unsubscribe = subscribeCollections(library.handle, () => void refresh());
    return () => {
      alive.current = false;
      request.current++;
      unsubscribe();
    };
  }, [library, active, refresh]);
  return {
    snapshot: loaded?.library === library ? loaded.snapshot : null,
    loading,
    failed,
    refresh,
  };
}

function useCollectionOperation(onBusyChange?: (busy: boolean) => void) {
  const library = useLibrary();
  const currentLibrary = useRef(library);
  currentLibrary.current = library;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const callback = useRef(onBusyChange);
  callback.current = onBusyChange;
  useEffect(() => {
    mounted.current = true;
    busyRef.current = false;
    setBusy(false);
    return () => {
      mounted.current = false;
      callback.current?.(false);
    };
  }, [library]);
  const isCurrent = () =>
    mounted.current && currentLibrary.current === library && library.isCurrent();
  const start = () => {
    if (busyRef.current || !isCurrent()) return false;
    busyRef.current = true;
    setBusy(true);
    callback.current?.(true);
    return true;
  };
  const finish = () => {
    if (!isCurrent() || !busyRef.current) return;
    busyRef.current = false;
    if (mounted.current) {
      setBusy(false);
      callback.current?.(false);
    }
  };
  return { busy, busyRef, mounted, isCurrent, start, finish };
}

function CollectionError({ error }: { error: string | null }) {
  const { colors } = useApp();
  return error ? (
    <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 13, lineHeight: 20 }}>
      {error}
    </Text>
  ) : null;
}

function NameEditor({
  name,
  setName,
  busy,
  save,
  cancel,
}: {
  name: string;
  setName: (name: string) => void;
  busy: boolean;
  save: () => void;
  cancel: () => void;
}) {
  const { colors, t } = useApp();
  return (
    <View style={{ gap: 14 }}>
      <TextInput
        autoFocus
        editable={!busy}
        value={name}
        onChangeText={setName}
        maxLength={80}
        accessibilityLabel={t('collectionsName')}
        placeholder={t('collectionsName')}
        placeholderTextColor={colors.muted}
        returnKeyType="done"
        onSubmitEditing={save}
        style={{
          color: colors.ink,
          backgroundColor: colors.background,
          padding: 14,
          borderRadius: 10,
          fontSize: 16,
        }}
      />
      <Text style={{ color: colors.muted, fontSize: 12 }}>{t('collectionsNameHint')}</Text>
      <Button busy={busy} disabled={!name.trim()} onPress={save}>
        {t('save')}
      </Button>
      <Button secondary disabled={busy} onPress={cancel}>
        {t('cancel')}
      </Button>
    </View>
  );
}

export type MoveBooksContentProps = {
  bookIds: string[];
  close: () => void;
  onMoved: () => Promise<void> | void;
  onBusyChange?: (busy: boolean) => void;
};

/** No Modal here: the book's existing menu can host the same move workflow. */
export function MoveBooksContent({ bookIds, close, onMoved, onBusyChange }: MoveBooksContentProps) {
  const { colors, t, notify } = useApp();
  const library = useLibrary();
  const { snapshot, loading, failed, refresh } = useCollectionSnapshot();
  const operation = useCollectionOperation(onBusyChange);
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ids = [...new Set(bookIds)];
  const identity = JSON.stringify([library.handle.key, library.epoch, ids]);
  useEffect(() => {
    setTarget(undefined);
    setCreating(false);
    setName('');
    setError(null);
  }, [identity]);
  const create = async () => {
    if (!operation.start()) return;
    setError(null);
    try {
      const group = await createCollection(library.handle, name);
      if (!operation.isCurrent()) return;
      // Creation and moving are separate confirmations. A failed move cannot create duplicates.
      setTarget(group.id);
      setCreating(false);
      setName('');
      await refresh();
    } catch (cause) {
      if (operation.isCurrent()) setError(t(collectionErrorKey(cause)));
    } finally {
      operation.finish();
    }
  };
  const move = async () => {
    if (target === undefined || !ids.length || !operation.start()) return;
    setError(null);
    let completed = false;
    try {
      await moveBooksToCollection(library.handle, ids, target);
      completed = true;
      if (operation.isCurrent()) {
        notify(t('collectionsMoved', { n: ids.length }));
        // A shelf refresh failure must not turn a committed move into a failed mutation.
        try {
          await onMoved();
        } catch {
          if (operation.isCurrent()) notify(t('collectionsLoadError'));
        }
      }
    } catch (cause) {
      if (operation.isCurrent()) setError(t(collectionErrorKey(cause)));
    } finally {
      operation.finish();
    }
    if (completed && operation.isCurrent()) close();
  };
  const destination = (id: string | null, label: string, count?: number) => (
    <Pressable
      key={id ?? 'ungrouped'}
      disabled={operation.busy || loading || failed}
      accessibilityRole="radio"
      accessibilityState={{ checked: target === id, disabled: operation.busy || loading || failed }}
      onPress={() => {
        if (operation.busyRef.current) return;
        setTarget(id);
        setError(null);
      }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      <Icon name={target === id ? 'checkmark-circle' : 'ellipse-outline'} color={colors.accent} />
      <Text style={{ flex: 1, color: colors.ink, fontSize: 15 }}>{label}</Text>
      {count !== undefined && (
        <Text style={{ color: colors.muted, fontSize: 12 }}>{t('bookCount', { n: count })}</Text>
      )}
    </Pressable>
  );
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>
        {t('collectionsMoveCount', { n: ids.length })}
      </Text>
      <CollectionError error={error} />
      {creating ? (
        <NameEditor
          name={name}
          setName={setName}
          busy={operation.busy}
          save={() => void create()}
          cancel={() => {
            if (operation.busyRef.current) return;
            setCreating(false);
            setError(null);
          }}
        />
      ) : (
        <>
          {loading && <ActivityIndicator color={colors.accent} />}
          {failed && (
            <>
              <CollectionError error={t('collectionsLoadError')} />
              <Button secondary disabled={operation.busy} onPress={() => void refresh()}>
                {t('retry')}
              </Button>
            </>
          )}
          {snapshot && (
            <View>
              {destination(null, t('collectionsUngrouped'))}
              {snapshot.groups.map((group) => destination(group.id, group.name, group.bookCount))}
            </View>
          )}
          <Button
            secondary
            icon="add"
            disabled={operation.busy || loading || failed}
            onPress={() => {
              if (operation.busyRef.current) return;
              setCreating(true);
              setError(null);
            }}
          >
            {t('collectionsCreate')}
          </Button>
          <Button
            busy={operation.busy}
            disabled={
              loading ||
              failed ||
              !snapshot ||
              target === undefined ||
              !ids.length ||
              (target !== null && !snapshot.groups.some((group) => group.id === target))
            }
            onPress={() => void move()}
          >
            {t('collectionsMove')}
          </Button>
        </>
      )}
    </View>
  );
}

export function MoveBooksSheet({
  bookIds,
  close,
  onMoved,
}: Omit<MoveBooksContentProps, 'bookIds' | 'onBusyChange'> & { bookIds: string[] | null }) {
  const { t } = useApp();
  const library = useLibrary();
  const busy = useRef(false);
  return (
    <Sheet
      tall
      visible={bookIds !== null}
      title={t('collectionsMove')}
      close={() => {
        if (!busy.current && library.isCurrent()) close();
      }}
    >
      {bookIds !== null && (
        <MoveBooksContent
          key={JSON.stringify([library.handle.key, library.epoch, bookIds])}
          bookIds={bookIds}
          close={close}
          onMoved={onMoved}
          onBusyChange={(value) => {
            busy.current = value;
          }}
        />
      )}
    </Sheet>
  );
}

type CollectionEditor = { kind: 'create' } | { kind: 'rename' | 'remove'; group: ShelfCollection };

export function CollectionManagerSheet({
  visible,
  close,
}: {
  visible: boolean;
  close: () => void;
}) {
  const { colors, t, notify } = useApp();
  const library = useLibrary();
  const { snapshot, loading, failed, refresh } = useCollectionSnapshot(visible);
  const operation = useCollectionOperation();
  const [editor, setEditor] = useState<CollectionEditor | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEditor(null);
    setName('');
    setError(null);
  }, [library, visible]);
  const edit = (value: CollectionEditor) => {
    if (!operation.isCurrent() || operation.busyRef.current) return;
    setEditor(value);
    setName(value.kind === 'rename' ? value.group.name : '');
    setError(null);
  };
  const save = async () => {
    if (!editor || !operation.start()) return;
    setError(null);
    try {
      if (editor.kind === 'create') await createCollection(library.handle, name);
      else if (editor.kind === 'rename')
        await renameCollection(library.handle, editor.group.id, name);
      else await removeCollection(library.handle, editor.group.id);
      if (!operation.isCurrent()) return;
      setEditor(null);
      setName('');
      notify(t('saved'));
      await refresh();
    } catch (cause) {
      if (operation.isCurrent()) setError(t(collectionErrorKey(cause)));
    } finally {
      operation.finish();
    }
  };
  const cancelEditor = () => {
    if (!operation.isCurrent() || operation.busyRef.current) return;
    setEditor(null);
    setError(null);
  };
  return (
    <Sheet
      tall
      visible={visible}
      title={t(
        editor?.kind === 'rename'
          ? 'collectionsRename'
          : editor?.kind === 'create'
            ? 'collectionsCreate'
            : 'collectionsManage',
      )}
      close={() => {
        if (operation.isCurrent() && !operation.busyRef.current) close();
      }}
    >
      <CollectionError error={error} />
      {editor?.kind === 'remove' ? (
        <View style={{ gap: 16 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '600' }}>
            {editor.group.name}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>
            {t('collectionsRemoveHint')}
          </Text>
          <Button danger busy={operation.busy} onPress={() => void save()}>
            {t('collectionsRemove')}
          </Button>
          <Button secondary disabled={operation.busy} onPress={cancelEditor}>
            {t('cancel')}
          </Button>
        </View>
      ) : editor ? (
        <NameEditor
          name={name}
          setName={setName}
          busy={operation.busy}
          save={() => void save()}
          cancel={cancelEditor}
        />
      ) : (
        <>
          <Button
            secondary
            icon="add"
            disabled={operation.busy || loading || failed}
            onPress={() => edit({ kind: 'create' })}
          >
            {t('collectionsCreate')}
          </Button>
          {loading && <ActivityIndicator color={colors.accent} />}
          {failed ? (
            <>
              <CollectionError error={t('collectionsLoadError')} />
              <Button secondary onPress={() => void refresh()}>
                {t('retry')}
              </Button>
            </>
          ) : snapshot && !snapshot.groups.length ? (
            <View style={{ gap: 10, paddingVertical: 18 }}>
              <Text style={{ color: colors.ink, fontSize: 16 }}>{t('collectionsEmpty')}</Text>
              <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>
                {t('collectionsEmptyHint')}
              </Text>
            </View>
          ) : null}
          {snapshot?.groups.map((group) => (
            <View
              key={group.id}
              style={[
                styles.spread,
                { paddingVertical: 12, borderBottomWidth: 0.5, borderColor: colors.border },
              ]}
            >
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={{ color: colors.ink, fontSize: 16 }}>{group.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {t('bookCount', { n: group.bookCount })}
                </Text>
              </View>
              <IconButton
                icon="pencil-outline"
                label={`${t('collectionsRename')}: ${group.name}`}
                disabled={operation.busy || loading || failed}
                onPress={() => edit({ kind: 'rename', group })}
              />
              <IconButton
                icon="trash-outline"
                label={`${t('collectionsRemove')}: ${group.name}`}
                disabled={operation.busy || loading || failed}
                onPress={() => edit({ kind: 'remove', group })}
              />
            </View>
          ))}
        </>
      )}
    </Sheet>
  );
}
