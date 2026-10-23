import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { prepareNotesExport, shareNotesExport } from '../adapters/notes-export';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { Button, Sheet } from './ui';

export type NotesExportScope = { bookId?: string; query?: string };
type Snapshot = Awaited<ReturnType<typeof prepareNotesExport>>;

export function NotesExportSheet({
  scope,
  close,
}: {
  scope: NotesExportScope | null;
  close: () => void;
}) {
  const { colors, preferences, t } = useApp();
  const library = useLibrary();
  const identity = scope
    ? JSON.stringify([
        library.handle.key,
        library.epoch,
        scope.bookId,
        scope.query,
        preferences.locale,
      ])
    : '';
  const current = useRef(identity);
  current.current = identity;
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const shareBusy = useRef(false);
  const mounted = useRef(false);
  const [sharing, setSharing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [prepared, setPrepared] = useState<{ identity: string; snapshot: Snapshot } | null>(null);
  const [failure, setFailure] = useState<{ identity: string; error: string } | null>(null);
  const snapshot = prepared?.identity === identity ? prepared.snapshot : null;
  const error = failure?.identity === identity ? failure.error : '';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const token = ++generation.current;
    controller.current?.abort();
    setPrepared(null);
    setFailure(null);
    if (!scope || !library.isCurrent()) return;
    const request = new AbortController();
    const abort = () => request.abort();
    library.signal.addEventListener('abort', abort, { once: true });
    controller.current = request;
    void prepareNotesExport(library.handle, scope, preferences.locale, request.signal)
      .then((snapshot) => {
        if (
          library.isCurrent() &&
          !request.signal.aborted &&
          generation.current === token &&
          current.current === identity
        )
          setPrepared({ identity, snapshot });
      })
      .catch((cause: unknown) => {
        if (
          !library.isCurrent() ||
          request.signal.aborted ||
          generation.current !== token ||
          current.current !== identity
        )
          return;
        const reason = cause instanceof Error ? cause.message : '';
        setFailure({
          identity,
          error: t(
            reason === 'notes_export_too_large'
              ? 'notesExportTooLarge'
              : reason === 'notes_export_empty'
                ? 'notesExportEmpty'
                : 'notesExportError',
          ),
        });
      });
    return () => {
      generation.current++;
      request.abort();
      library.signal.removeEventListener('abort', abort);
    };
  }, [library, identity, attempt]);

  const dismiss = () => {
    if (shareBusy.current || !library.isCurrent()) return;
    generation.current++;
    controller.current?.abort();
    setPrepared(null);
    close();
  };
  const share = async () => {
    if (
      !library.isCurrent() ||
      !snapshot ||
      !identity ||
      current.current !== identity ||
      shareBusy.current
    )
      return;
    const token = generation.current;
    shareBusy.current = true;
    setSharing(true);
    setFailure(null);
    try {
      await shareNotesExport(library, snapshot);
    } catch {
      if (
        library.isCurrent() &&
        mounted.current &&
        generation.current === token &&
        current.current === identity
      )
        setFailure({ identity, error: t('notesExportError') });
    } finally {
      shareBusy.current = false;
      // A replaced scope still waits for the one active system share to finish.
      if (mounted.current) setSharing(false);
    }
  };
  return (
    <Sheet visible={scope !== null} title={t('notesExport')} close={dismiss}>
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{t('notesExportScope')}</Text>
        <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>
          {scope?.bookId ? snapshot?.bookTitle || t('notes') : t('notesAllBooks')}
        </Text>
        {!!scope?.query?.trim() && (
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 21 }}>
            {t('notesExportQuery', { query: scope.query.trim() })}
          </Text>
        )}
      </View>
      <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 22 }}>
        {t('notesExportHint')}
      </Text>
      {!snapshot && !error && scope && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.muted, flex: 1 }}>{t('notesExportPreparing')}</Text>
        </View>
      )}
      {snapshot && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.ink, fontSize: 17 }}>
          {t('notesExportSummary', { notes: snapshot.noteCount, books: snapshot.bookCount })}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
          {error}
        </Text>
      )}
      {snapshot ? (
        <Button busy={sharing} icon="share-outline" onPress={() => void share()}>
          {t('notesExportShare')}
        </Button>
      ) : error ? (
        <Button secondary onPress={() => setAttempt((value) => value + 1)}>
          {t('retry')}
        </Button>
      ) : null}
      <Button secondary disabled={sharing} onPress={dismiss}>
        {t('cancel')}
      </Button>
    </Sheet>
  );
}
