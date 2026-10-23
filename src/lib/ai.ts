import { effectiveBookLanguage, readingScopeParagraphs } from '../../packages/reading-core/src';
import { storageUserId } from './storage-scope';
import { translationFingerprint } from './translation-prompt';
import type { Book, Message, Paragraph, Settings } from './types';
import { languageName } from './types';
import { measureClient } from './observability/client';

export type Source = { id: string; chapter: string; text: string };
type Request = {
  action: 'ask' | 'translate' | 'terms';
  title: string;
  question?: string;
  target?: string;
  selection?: string;
  readingPassage?: string;
  scope?: string;
  sources?: Source[];
  history?: Message[];
  bookLanguage?: string;
};
export class AIRequestError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
    this.name = 'AIRequestError';
  }
}
async function request(settings: Settings, body: Request, signal: AbortSignal) {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-reader-user': storageUserId() || '' },
    signal,
    body: JSON.stringify({
      ...body,
      ...(body.action === 'translate'
        ? {
            translationFingerprint: translationFingerprint(settings),
          }
        : {}),
      language: languageName(settings.language),
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && data.code === 'ai-config-changed' && data.config)
      window.dispatchEvent(
        new CustomEvent('ai-read-ai-configuration-change', { detail: data.config }),
      );
    throw new AIRequestError(
      data.error || `请求失败（${response.status}）`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  return response;
}

export async function streamAI(
  settings: Settings,
  body: Request,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  const measured = measureClient('ai_request');
  try {
    const result = await readAIStream(settings, body, signal, onText);
    measured();
    return result;
  } catch (error) {
    measured(signal.aborted ? 'cancelled' : 'error', { errorKind: 'network' });
    throw error;
  }
}

async function readAIStream(
  settings: Settings,
  body: Request,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  const response = await request(settings, body, signal);
  if (!response.body) throw new Error('模型没有返回内容。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    output = '',
    finished = false;
  const handle = (event: string) => {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') {
      finished = true;
      return;
    }
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      throw new Error('模型返回了无效的流式数据。');
    }
    if (chunk.error) {
      const code = Number(chunk.error.code);
      throw new AIRequestError(
        chunk.error.message || '模型返回错误。',
        chunk.error.retryable ?? (code === 408 || code === 429 || code >= 500),
      );
    }
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason === 'length')
      throw new AIRequestError('模型输出达到长度上限，内容未完整生成。');
    if (choice?.finish_reason === 'content_filter')
      throw new AIRequestError('模型服务过滤了本次输出。');
    const content = choice?.delta?.content;
    if (typeof content === 'string') {
      output += content;
      onText(output);
    }
  };
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r/g, '');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        handle(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
      if (done) {
        if (buffer.trim()) handle(buffer);
        break;
      }
    }
    if (!finished) throw new Error('连接提前结束，内容可能不完整，请重试。');
    if (!output.trim()) throw new Error('模型没有返回正文，请检查模型是否支持文字输出。');
    return output;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function expandQuestion(
  settings: Settings,
  book: Book,
  question: string,
  selection: string,
  history: Message[],
  signal: AbortSignal,
) {
  const response = await request(
    settings,
    {
      action: 'terms',
      title: book.title,
      bookLanguage: effectiveBookLanguage(book),
      question,
      selection,
      history: history.slice(-4),
    },
    signal,
  );
  const data = await response.json();
  return typeof data.text === 'string' ? data.text : '';
}

function tokens(value: string) {
  const lower = value.toLowerCase();
  const words = lower.match(/[\p{L}\p{N}]{2,}/gu) || [];
  const cjk = lower.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || [];
  const stop = new Set([
    'the',
    'and',
    'that',
    'this',
    'with',
    'from',
    'what',
    'does',
    'here',
    'have',
    'about',
    'which',
  ]);
  return [
    ...new Set([
      ...words.filter((w) => !stop.has(w)),
      ...cjk.flatMap((w) =>
        Array.from({ length: Math.max(0, w.length - 1) }, (_, i) => w.slice(i, i + 2)),
      ),
    ]),
  ].slice(0, 120);
}

export function buildContext(
  book: Book,
  chapter: number,
  farthest: number,
  scope: Settings['scope'],
  query: string,
  selection?: Paragraph,
  anchorId?: string,
) {
  const entries = readingScopeParagraphs(
    book,
    {
      chapter,
      farthest,
      paragraph: anchorId ?? selection?.id ?? book.chapters[chapter]?.paragraphs[0]?.id ?? '',
    },
    scope,
  );
  const candidates = entries.map(({ paragraph, ...location }) => ({ ...paragraph, ...location }));
  const ordinalMap = new Map(entries.map((entry) => [entry.paragraph.id, entry.ordinal]));
  const queryTokens = tokens(query);
  const budget = 46_000;
  const allSize = candidates.reduce((sum, p) => sum + p.text.length + 80, 0);
  let ranked = candidates;
  if (allSize > budget) {
    const selectedIndex = selection ? candidates.findIndex((p) => p.id === selection.id) : -1;
    ranked = candidates
      .map((p, i) => ({
        ...p,
        score:
          (p.id === selection?.id ? 10000 : 0) +
          (selectedIndex >= 0 && Math.abs(i - selectedIndex) <= 3 ? 100 : 0) +
          (p.chapterIndex === chapter ? 3 : 0) +
          queryTokens.reduce((sum, term) => sum + (p.text.toLowerCase().includes(term) ? 5 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score);
  }
  const chosen: Source[] = [];
  let used = 0;
  for (const p of ranked) {
    if (used + p.text.length + 80 > budget || chosen.length >= 400) continue;
    used += p.text.length + 80;
    chosen.push({ id: p.id, chapter: p.chapter, text: p.text });
  }
  chosen.sort((a, b) => ordinalMap.get(a.id)! - ordinalMap.get(b.id)!);
  return { sources: chosen, partial: chosen.length < candidates.length, total: candidates.length };
}

export function translationKey(settings: Settings, paragraphId: string) {
  return `${settings.language}:${paragraphId}:${translationFingerprint(settings)}`;
}
