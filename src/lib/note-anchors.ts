import type { Note, NoteAnchor } from './types';

/** DOM offsets and String.slice both use UTF-16 offsets, including inside existing marks. */
export function captureNoteSelection(range: Range): { text: string; anchor?: NoteAnchor } {
  const raw = range.toString();
  const text = Array.from(raw.trim()).slice(0, 4000).join('');
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const root = element?.closest<HTMLElement>('[data-note-source]');
  if (!root || !root.contains(range.endContainer) || !text) return { text };
  const source = root.dataset.noteSource;
  if (source !== 'original' && source !== 'translation') return { text };
  const translationKey = root.dataset.noteKey;
  if (source === 'translation' && !translationKey) return { text };
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length + raw.length - raw.trimStart().length;
  const end = start + text.length;
  if (root.textContent?.slice(start, end) !== text) return { text };
  return {
    text,
    anchor: { source, start, end, ...(source === 'translation' ? { translationKey } : {}) },
  };
}

export function noteRange(text: string, note: Note, source: NoteAnchor['source'], key?: string) {
  if (!note.quote) return null;
  const anchor = note.anchor;
  if (anchor) {
    if (
      anchor.source !== source ||
      (source === 'translation' && anchor.translationKey !== key) ||
      text.slice(anchor.start, anchor.end) !== note.quote
    )
      return null;
    return { start: anchor.start, end: anchor.end };
  }
  // Legacy notes retain their quotes. Ambiguous old locations cannot be reconstructed safely.
  const start = text.indexOf(note.quote);
  return start >= 0 && text.indexOf(note.quote, start + 1) < 0
    ? { start, end: start + note.quote.length }
    : null;
}
