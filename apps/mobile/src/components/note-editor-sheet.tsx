import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { Note } from '@bypage/reading-core';
import { updateNoteText } from '../adapters/database';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { Button, Sheet, styles } from './ui';

type Props = {
  note: Note | null;
  close: () => void;
  onSaved: (note: Note) => void;
  bookTitle?: string;
};
type FormProps = Omit<Props, 'note'> & {
  note: Note;
  /** Synchronous notification so the owning sheet can guard header/backdrop dismissal. */
  onBusyChange?: (busy: boolean) => void;
};

export function NoteEditorSheet({ note, ...props }: Props) {
  const { t } = useApp();
  const library = useLibrary();
  const busy = useRef(false);
  return note ? (
    <Sheet
      tall
      visible
      title={t('editNote')}
      close={() => {
        if (!busy.current && library.isCurrent()) props.close();
      }}
    >
      <NoteEditorForm note={note} {...props} onBusyChange={(value) => (busy.current = value)} />
    </Sheet>
  ) : null;
}

/** Content only: a reader notebook can switch modes inside its existing native sheet. */
export function NoteEditorForm(props: FormProps) {
  const library = useLibrary();
  return (
    <NoteEditor
      key={JSON.stringify([library.handle.key, library.epoch, props.note.bookId, props.note.id])}
      {...props}
    />
  );
}

function NoteEditor({ note, close, onSaved, bookTitle, onBusyChange }: FormProps) {
  const { colors, t, notify } = useApp();
  const library = useLibrary();
  // Preserve the opened version, even when a background list refresh changes its props.
  const [expected] = useState<Note>(() => ({
    ...note,
    ...(note.anchor ? { anchor: { ...note.anchor } } : {}),
  }));
  const [draft, setDraft] = useState(expected.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const mounted = useRef(false);
  const busyChanged = useRef(onBusyChange);
  busyChanged.current = onBusyChange;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (saving.current) {
        saving.current = false;
        busyChanged.current?.(false);
      }
    };
  }, [library]);
  const setSaving = (value: boolean) => {
    saving.current = value;
    if (mounted.current && library.isCurrent()) {
      busyChanged.current?.(value);
      setBusy(value);
    }
  };
  const dismiss = () => {
    if (!saving.current && library.isCurrent()) close();
  };
  const save = async () => {
    if (saving.current || !mounted.current || !library.isCurrent()) return;
    if (draft.trim().length > 50000) {
      setError(t('noteTextTooLong'));
      return;
    }
    setSaving(true);
    setError('');
    let saved: Note;
    try {
      saved = await updateNoteText(library.handle, expected, draft);
    } catch (cause) {
      if (mounted.current && library.isCurrent()) {
        const reason = cause instanceof Error ? cause.message : '';
        setError(
          t(
            reason === 'note_changed'
              ? 'noteChanged'
              : reason === 'note_missing'
                ? 'noteMissing'
                : reason === 'note_text_too_long'
                  ? 'noteTextTooLong'
                  : 'noteSavedError',
          ),
        );
      }
      setSaving(false);
      return;
    }
    if (!mounted.current || !library.isCurrent()) return;
    try {
      // A callback failure happens after the commit; it must not be reported as a failed save.
      await onSaved(saved);
    } catch {
      if (mounted.current && library.isCurrent()) notify(t('noteSavedRefreshError'));
    } finally {
      // Release the owning sheet's synchronous guard before requesting dismissal.
      setSaving(false);
      if (mounted.current && library.isCurrent()) {
        close();
      }
    }
  };

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 10 }}>
        {!!bookTitle && (
          <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>
            {bookTitle}
          </Text>
        )}
        <Text style={{ color: colors.accent, fontSize: 12 }}>
          {t(
            expected.anchor?.source === 'translation'
              ? 'translation'
              : expected.anchor?.source === 'original'
                ? 'original'
                : 'noteSourceUnknown',
          )}
        </Text>
        <Text numberOfLines={6} style={{ color: colors.muted, lineHeight: 24 }}>
          {expected.quote}
        </Text>
      </View>
      <TextInput
        autoFocus
        multiline
        editable={!busy}
        maxLength={50000}
        value={draft}
        onChangeText={setDraft}
        accessibilityLabel={t('notePlaceholder')}
        placeholder={t('notePlaceholder')}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          {
            height: 180,
            color: colors.ink,
            borderColor: colors.border,
            textAlignVertical: 'top',
          },
        ]}
      />
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
        {t('noteHighlightHint')}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
          {error}
        </Text>
      )}
      <Button busy={busy} onPress={() => void save()}>
        {t('save')}
      </Button>
      <Button secondary disabled={busy} onPress={dismiss}>
        {t('cancel')}
      </Button>
    </View>
  );
}
