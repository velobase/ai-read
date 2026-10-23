import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  normalizeSearch,
  readingChapterNavigation,
  readingScopeParagraphs,
  type Book,
  type Note,
  type Position,
} from '@bypage/reading-core';
import { useApp } from '../context';
import { NoteEditorForm } from './note-editor-sheet';
import { NoteExcerpt } from './note-excerpt';
import { Button, Chip, Icon, IconButton, Sheet, styles } from './ui';

type Scope = 'chapter' | 'book';
type Props = {
  book: Book;
  position: Pick<Position, 'chapter' | 'paragraph' | 'farthest'>;
  notes: Note[];
  visible: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  close: () => void;
  add: () => void;
  open: (note: Note) => void;
  onSaved: (note: Note) => void;
};

export function ReaderNotesSheet(props: Props) {
  const { t } = useApp();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('book');
  const [editing, setEditing] = useState<Note | null>(null);
  const editingBusy = useRef(false);
  const active = useRef({ visible: props.visible, bookId: props.book.id, editing });
  active.current = { visible: props.visible, bookId: props.book.id, editing };
  useEffect(() => {
    if (!props.visible) {
      editingBusy.current = false;
      setEditing(null);
    }
  }, [props.visible]);
  useEffect(() => {
    setQuery('');
    setScope('book');
    editingBusy.current = false;
    setEditing(null);
  }, [props.book.id]);
  const editor = editing?.bookId === props.book.id ? editing : null;
  const isEditingCurrent = () =>
    !!editor &&
    active.current.visible &&
    active.current.bookId === editor.bookId &&
    active.current.editing === editor;
  const closeEditor = () => {
    if (isEditingCurrent() && !editingBusy.current) {
      Keyboard.dismiss();
      setEditing(null);
    }
  };
  return (
    <Sheet
      visible={props.visible}
      onShow={props.onShow}
      onDismiss={props.onDismiss}
      tall
      scrollable={false}
      title={t(editor ? 'editNote' : 'notes')}
      close={editor ? closeEditor : props.close}
    >
      {!props.visible ? null : editor ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22 }}>
          <NoteEditorForm
            key={JSON.stringify([editor.bookId, editor.id])}
            note={editor}
            bookTitle={props.book.title}
            onBusyChange={(busy) => {
              if (isEditingCurrent()) editingBusy.current = busy;
            }}
            onSaved={(note) => {
              if (isEditingCurrent()) props.onSaved(note);
            }}
            close={closeEditor}
          />
        </ScrollView>
      ) : (
        <Notebook
          {...props}
          query={query}
          setQuery={setQuery}
          scope={scope}
          setScope={setScope}
          edit={(note) => {
            Keyboard.dismiss();
            editingBusy.current = false;
            setEditing(note);
          }}
        />
      )}
    </Sheet>
  );
}

function Notebook({
  book,
  position,
  notes,
  add,
  open,
  query,
  setQuery,
  scope,
  setScope,
  edit,
}: Props & {
  query: string;
  setQuery: (query: string) => void;
  scope: Scope;
  setScope: (scope: Scope) => void;
  edit: (note: Note) => void;
}) {
  const { colors, t } = useApp();
  const list = useRef<FlatList<Note>>(null);
  const needle = normalizeSearch(query.trim());
  const paragraphChapters = useMemo(
    () =>
      new Map(
        book.chapters.flatMap((chapter, index) =>
          chapter.paragraphs.map((paragraph) => [paragraph.id, index] as const),
        ),
      ),
    [book],
  );
  const chapterIds = useMemo(
    () =>
      new Set(
        readingScopeParagraphs(
          book,
          { chapter: position.chapter, paragraph: position.paragraph, farthest: position.chapter },
          'chapter',
        ).map(({ paragraph }) => paragraph.id),
      ),
    [book, position.chapter, position.paragraph],
  );
  const chapterTitle = useMemo(() => {
    const current = readingChapterNavigation(book, position).current;
    return current?.kind === 'page' && current.sourcePage
      ? t('pdfPage', { n: current.sourcePage })
      : current?.title || book.chapters[position.chapter]?.title || '';
  }, [book, position.chapter, position.paragraph, t]);
  const scoped = useMemo(
    () =>
      notes.filter(
        (note) => note.bookId === book.id && (scope === 'book' || chapterIds.has(note.paragraphId)),
      ),
    [notes, book.id, scope, chapterIds],
  );
  const [result, setResult] = useState<{ input: Note[]; needle: string; notes: Note[] }>();
  useEffect(() => {
    let cancelled = false;
    if (!needle) return;
    // Search the loaded notebook, yielding between chunks instead of retaining
    // another copy of all text.
    const timer = setTimeout(() => {
      void (async () => {
        const found: Note[] = [];
        let characters = 0;
        let count = 0;
        for (const note of scoped) {
          if (cancelled) return;
          if (
            normalizeSearch(note.quote).includes(needle) ||
            normalizeSearch(note.text).includes(needle)
          )
            found.push(note);
          characters += note.quote.length + note.text.length;
          if (++count % 80 === 0 || characters >= 64000) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            characters = 0;
          }
        }
        if (!cancelled) setResult({ input: scoped, needle, notes: found });
      })();
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scoped, needle]);
  const searching = !!needle && (result?.input !== scoped || result.needle !== needle);
  const filtered = needle ? (searching ? [] : result!.notes) : scoped;
  useEffect(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [needle, scope]);

  return (
    <>
      <View style={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 12, gap: 12 }}>
        <Button
          icon="create-outline"
          onPress={() => {
            Keyboard.dismiss();
            add();
          }}
        >
          {t('addNote')}
        </Button>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip active={scope === 'book'} onPress={() => setScope('book')}>
            {t('readerNotesBook')}
          </Chip>
          <Chip active={scope === 'chapter'} onPress={() => setScope('chapter')}>
            {t('readerNotesChapter')}
          </Chip>
        </View>
        {scope === 'chapter' && !!chapterTitle && (
          <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
            {chapterTitle}
          </Text>
        )}
        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <TextInput
            accessibilityLabel={t('readerNotesSearch')}
            placeholder={t('readerNotesSearch')}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            maxLength={160}
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.input, { flex: 1, color: colors.ink, borderColor: colors.border }]}
          />
          {!!query && (
            <IconButton
              icon="close-circle-outline"
              label={t('clearSearch')}
              onPress={() => setQuery('')}
            />
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {searching && <ActivityIndicator size="small" color={colors.accent} />}
          <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: 12 }}>
            {searching
              ? t('searchingNotes')
              : t('readerNotesResults', { count: filtered.length, total: scoped.length })}
          </Text>
        </View>
      </View>
      <FlatList
        ref={list}
        data={filtered}
        keyExtractor={(note) => JSON.stringify([note.bookId, note.id])}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 22 }}
        ListEmptyComponent={
          !searching ? (
            <Text style={{ paddingVertical: 24, color: colors.muted, lineHeight: 23 }}>
              {t(!notes.length ? 'notesEmptyHint' : 'readerNotesNoMatches')}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <NoteRow
            note={item}
            book={book}
            chapter={paragraphChapters.get(item.paragraphId)}
            query={query}
            open={open}
            edit={edit}
          />
        )}
      />
    </>
  );
}

const NoteRow = memo(function NoteRow({
  note,
  book,
  chapter,
  query,
  open,
  edit,
}: {
  note: Note;
  book: Book;
  chapter?: number;
  query: string;
  open: (note: Note) => void;
  edit: (note: Note) => void;
}) {
  const { colors, t, preferences } = useApp();
  const target = useMemo(
    () =>
      chapter === undefined
        ? undefined
        : readingChapterNavigation(book, { chapter, paragraph: note.paragraphId }).current,
    [book, chapter, note.paragraphId],
  );
  const title =
    target?.kind === 'page' && target.sourcePage
      ? t('pdfPage', { n: target.sourcePage })
      : target?.title || (chapter === undefined ? '' : book.chapters[chapter]?.title);
  const page = chapter === undefined ? undefined : book.chapters[chapter]?.sourcePage;
  const translated = note.anchor?.source === 'translation';
  const source = t(
    translated
      ? 'translation'
      : note.anchor?.source === 'original'
        ? 'original'
        : 'noteSourceUnknown',
  );
  const language = translated ? note.anchor?.translationKey?.split(':')[0] : undefined;
  return (
    <View
      style={{ paddingVertical: 16, borderBottomWidth: 0.5, borderColor: colors.border, gap: 10 }}
    >
      {!!title && (
        <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
          {title}
          {page && target?.kind !== 'page' ? ` · ${t('pdfPage', { n: page })}` : ''}
        </Text>
      )}
      <Text style={{ color: colors.accent, fontSize: 12 }}>
        {source}
        {language ? ` · ${language}` : ''}
        {' · '}
        {new Date(note.createdAt).toLocaleDateString(preferences.locale)}
      </Text>
      <NoteExcerpt text={note.quote} query={query} />
      {!!note.text && <NoteExcerpt text={note.text} query={query} thought />}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: chapter === undefined }}
          disabled={chapter === undefined}
          onPress={() => {
            Keyboard.dismiss();
            open(note);
          }}
          style={{
            minHeight: 40,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            opacity: chapter === undefined ? 0.4 : 1,
          }}
        >
          <Icon name="book-outline" size={16} color={colors.accent} />
          <Text style={{ color: colors.accent, fontSize: 13 }}>{t('readPassage')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => edit(note)}
          style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Icon name="create-outline" size={16} color={colors.accent} />
          <Text style={{ color: colors.accent, fontSize: 13 }}>{t('editNote')}</Text>
        </Pressable>
      </View>
    </View>
  );
});
