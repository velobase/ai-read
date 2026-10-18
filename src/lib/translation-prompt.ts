export const MAX_TRANSLATION_PROMPT_LENGTH = 6000;

// These are editable starting points, not model-specific instructions.
export const DEFAULT_TRANSLATION_PROMPT = `Translate the target passage into {{to}} using natural, clear, contemporary written language.
Preserve every claim, qualification, contrast, causal link, number and reference. Do not summarize, embellish, simplify away a distinction or add explanations.
Rebuild sentences in the target language's normal word order instead of following the source word for word. You may split a long sentence when its logical relationships remain clear.
When translating into Chinese, use fluent modern written Chinese. Avoid archaic diction, ornate phrasing, unnecessary four-character expressions and stiff translationese. Do not make an older book sound like classical Chinese merely because it is old.
Use the surrounding passages to resolve who is acting and what pronouns refer to. Keep established technical terms accurate and consistent; translate their meaning in context rather than mechanically translating each word.
Preserve the paragraph structure. Return only the translation of the target passage.`;

export const translationPresets = [
  { id: 'natural', zh: '自然流畅', en: 'Natural', prompt: '' },
  {
    id: 'academic',
    zh: '严谨学术',
    en: 'Academic',
    prompt: `Translate the target passage into {{to}} as clear, contemporary academic prose.
Preserve the full argument, distinctions, definitions, qualifications, uncertainty, numbers and references. Use established terminology consistently and resolve ambiguous terms from the surrounding passages.
Prefer precise, readable sentences over literal word order. Do not use archaic or ornamental language, add commentary, or simplify away technical meaning.
Keep the paragraph structure and output only the translation of the target passage.`,
  },
  {
    id: 'close',
    zh: '贴近原文',
    en: 'Close to source',
    prompt: `Translate the target passage from {{from}} into {{to}}, staying close to the author's wording, tone, emphasis and order of ideas.
Preserve every statement, qualification, repetition, technical distinction and reference. Use natural grammar in the target language; avoid awkward word-for-word calques or artificially archaic language.
Use the surrounding passages for consistent names and terminology. Preserve the paragraph structure and return only the translation of the target passage.`,
  },
] as const;

export function effectiveTranslationPrompt(value?: string) {
  return value?.trim() || DEFAULT_TRANSLATION_PROMPT;
}

export function renderTranslationPrompt(value: string, to: string, from: string) {
  // Single-pass replacement: never evaluate templates, or recursively expand
  // values derived from book metadata. Source text stays in the user payload.
  return effectiveTranslationPrompt(value).replace(/\{\{\s*(to|from)\s*\}\}/g, (_, name: string) =>
    name === 'to' ? to : from,
  );
}

type TranslationConfiguration = { baseUrl: string; model: string; translationPrompt?: string };
export function translationFingerprint(config: TranslationConfiguration) {
  let baseUrl = config.baseUrl;
  try {
    baseUrl = new URL(baseUrl).href;
  } catch {
    /* endpoint validation is server-side */
  }
  baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const input = JSON.stringify([
    baseUrl,
    config.model,
    effectiveTranslationPrompt(config.translationPrompt),
  ]);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `prompt-v1-${hash >>> 0}`;
}
