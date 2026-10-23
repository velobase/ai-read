export type ReadingSource = { id: string; chapter: string; text: string };
export type ReadingQuestion = {
  title: string;
  bookLanguage: string;
  language: string;
  question: string;
  selection?: string;
  readingPassage?: string;
  scope?: 'chapter' | 'read' | 'book';
  context?: { totalParagraphs: number; partial: boolean };
  /** Public provider/model identity; never a credential or session identifier. */
  aiContextKey?: string;
  sources: ReadingSource[];
  history: { role: 'user' | 'assistant'; content: string }[];
};
/** Pure SSE parsing shared by hosts; transport and UTF-8 decoding belong to adapters. */
export class CompletionStream {
  private buffer = '';
  text = '';
  done = false;
  push(value: string) {
    this.buffer += value.replace(/\r/g, '');
    if (this.buffer.length > 1024 * 1024) throw new Error('response_too_large');
    let index: number;
    while ((index = this.buffer.indexOf('\n\n')) >= 0) {
      const event = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      this.event(event);
    }
    return this.text;
  }
  finish() {
    if (this.buffer.trim()) this.event(this.buffer);
    this.buffer = '';
    if (!this.done) throw new Error('incomplete_response');
    if (!this.text.trim()) throw new Error('empty_response');
    return this.text;
  }
  private event(event: string) {
    if (this.done) return;
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') {
      this.done = true;
      return;
    }
    const body = JSON.parse(data);
    if (body.error)
      throw new Error(
        typeof body.error.message === 'string' ? body.error.message.slice(0, 500) : 'model_error',
      );
    const choice = body.choices?.[0];
    if (['length', 'content_filter'].includes(choice?.finish_reason))
      throw new Error('incomplete_response');
    const content = choice?.delta?.content;
    if (typeof content === 'string') this.text += content;
    if (this.text.length > 100000) throw new Error('response_too_large');
  }
}
