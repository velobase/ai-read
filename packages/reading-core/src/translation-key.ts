import { validSyncId } from './reading-validation';

export type ResolvedTranslationKey = {
  language: string;
  paragraphId: string;
  version: string;
};

/** Resolve an exact cache identity against its book; never select another edition. */
export function resolveTranslationKey(
  value: unknown,
  paragraphIds: ReadonlySet<string>,
): ResolvedTranslationKey | null {
  if (!validSyncId(value)) return null;
  const languageEnd = value.indexOf(':');
  const language = value.slice(0, languageEnd);
  if (languageEnd < 0 || !/^[\w-]{2,30}$/.test(language)) return null;

  let result: ResolvedTranslationKey | null = null;
  for (
    let separator = value.indexOf(':', languageEnd + 1);
    separator !== -1;
    separator = value.indexOf(':', separator + 1)
  ) {
    const paragraphId = value.slice(languageEnd + 1, separator);
    if (!paragraphIds.has(paragraphId)) continue;
    const version = value.slice(separator + 1);
    if (!version) continue;
    // Legacy fingerprints are single opaque segments. Edition identifiers use
    // validSyncId and may themselves contain colons, just like paragraph IDs.
    if (version.startsWith('edition-')) {
      if (!validSyncId(version.slice('edition-'.length))) continue;
    } else if (version.includes(':')) continue;
    // A key that could name two actual passages cannot safely be reassigned.
    if (result) return null;
    result = { language, paragraphId, version };
  }
  return result;
}
