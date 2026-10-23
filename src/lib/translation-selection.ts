import { resolveTranslationKey } from '../../packages/reading-core/src/translation-key';
import type { Book } from './types';

/** The legacy reader's single-version preference, shared by migration and export. */
export function selectLegacyTranslations(
  book: Book,
  language: string,
  values: Record<string, string>,
  preferredVersion?: string,
) {
  const ids = new Set(book.chapters.flatMap((c) => c.paragraphs.map((p) => p.id)));
  const versions = new Map<string, Map<string, { key: string; text: string }>>();
  const fallback = new Map<string, { key: string; text: string }>();
  for (const [key, text] of Object.entries(values)) {
    const identity = resolveTranslationKey(key, ids);
    if (
      !identity ||
      identity.language !== language ||
      identity.version.startsWith('edition-') ||
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 1024 * 1024
    )
      continue;
    const paragraphs = versions.get(identity.version) || new Map();
    paragraphs.set(identity.paragraphId, { key, text });
    versions.set(identity.version, paragraphs);
    if (!fallback.has(identity.paragraphId)) fallback.set(identity.paragraphId, { key, text });
  }
  const result = new Map<
    number,
    { texts: Record<string, string>; keys: Record<string, string>; complete: boolean }
  >();
  const candidates = [...versions.entries()].sort(
    ([a], [b]) => Number(b === preferredVersion) - Number(a === preferredVersion),
  );
  for (const [index, chapter] of book.chapters.entries()) {
    const complete = candidates.find(([, paragraphs]) =>
      chapter.paragraphs.every((p) => paragraphs.has(p.id)),
    )?.[1];
    const texts: Record<string, string> = Object.create(null);
    const keys: Record<string, string> = Object.create(null);
    for (const p of chapter.paragraphs) {
      const saved =
        complete?.get(p.id) ||
        (preferredVersion && versions.get(preferredVersion)?.get(p.id)) ||
        fallback.get(p.id);
      if (!saved) continue;
      texts[p.id] = saved.text;
      keys[p.id] = saved.key;
    }
    if (Object.keys(texts).length)
      result.set(index, { texts, keys, complete: chapter.paragraphs.every((p) => !!texts[p.id]) });
  }
  return result;
}
