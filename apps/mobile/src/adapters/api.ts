import { fetch as nativeFetch } from 'expo/fetch';
import {
  CompletionStream,
  createApiClient,
  type ReadingQuestion,
  type ReadingTranslation,
} from '@bypage/api-client';
import { measured } from './diagnostics';

export { apiOrigin, normalizeServerOrigin } from './server-origin';
import { apiOrigin } from './server-origin';
import { requestScope } from './account';

export const checkConnection = (origin = apiOrigin, signal?: AbortSignal) =>
  measured('server.check', () =>
    createApiClient(async (path) => {
      const scope = requestScope(origin, signal, 8000);
      try {
        const headers = await scope.headers();
        const response = await nativeFetch(`${scope.origin}${path}`, {
          credentials: 'omit',
          signal: scope.signal,
          redirect: 'error',
          headers: { Accept: 'application/json', ...headers },
        });
        await scope.checkStatus(response.status);
        const body: unknown = await response.json();
        scope.assertCurrent();
        return { status: response.status, body };
      } finally {
        scope.close();
      }
    }).getCapabilities(),
  );

export function askReading(
  origin: string,
  question: ReadingQuestion,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  return readingCompletion(origin, question, 'ask', signal, onText);
}
export function translateReading(origin: string, input: ReadingTranslation, signal: AbortSignal) {
  return readingCompletion(origin, input, 'translate', signal, () => {});
}
async function readingCompletion(
  origin: string,
  input: ReadingQuestion | ReadingTranslation,
  action: 'ask' | 'translate',
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  return measured(action === 'ask' ? 'ai.ask' : 'ai.translate', async () => {
    const scope = requestScope(origin, signal);
    let result: string;
    try {
      const headers = await scope.headers();
      const response = await nativeFetch(`${scope.origin}/api/mobile/v1/${action}`, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        signal: scope.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Origin: scope.origin,
          ...headers,
        },
        body: JSON.stringify(input),
      });
      await scope.checkStatus(response.status);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        scope.assertCurrent();
        throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('empty_response');
      const decoder = new TextDecoder();
      const stream = new CompletionStream();
      let bytes = 0,
        last = '';
      try {
        while (!stream.done) {
          scope.assertCurrent();
          const { done, value } = await reader.read();
          scope.assertCurrent();
          if (value) bytes += value.byteLength;
          if (bytes > 2 * 1024 * 1024) throw new Error('response_too_large');
          const text = stream.push(decoder.decode(value, { stream: !done }));
          if (text !== last) {
            last = text;
            onText(text);
          }
          if (done) break;
        }
        result = stream.finish();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      // Cleanup itself awaits native IO, so validate again before committing a result.
      scope.assertCurrent();
      return result;
    } finally {
      scope.close();
    }
  });
}
