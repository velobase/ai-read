import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { LibraryLease } from './library-scope';

export type SharedAssistantAnswer = {
  bookTitle: string;
  question: string;
  answer: string;
  createdAt: number;
  scope: 'chapter' | 'read' | 'book';
  status: 'complete' | 'stopped' | 'error';
  sources: { id: string; chapter: string; text: string }[];
  locale: 'zh-CN' | 'en';
};

/** Export one explicit user-selected turn. Credentials and account partitions are never included. */
export async function shareAssistantAnswer(
  lease: LibraryLease,
  turn: SharedAssistantAnswer,
  isCurrent: () => boolean,
) {
  const check = () => {
    lease.assertCurrent();
    if (!isCurrent()) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  };
  check();
  const available = await Sharing.isAvailableAsync();
  check();
  if (!available) throw new Error('sharing_unavailable');
  const zh = turn.locale === 'zh-CN';
  const label = {
    chapter: zh ? '当前章节' : 'Current chapter',
    read: zh ? '已读范围' : 'Read chapters',
    book: zh ? '全书' : 'Whole-book search',
  }[turn.scope];
  const plainLine = (value: string) => value.replace(/[\r\n\t]+/g, ' ').trim();
  const quote = (value: string) =>
    value
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join('\n');
  const body = [
    `# ${plainLine(turn.bookTitle)}`,
    `${zh ? '时间' : 'Date'}: ${new Date(turn.createdAt).toISOString()}`,
    `${zh ? '参考范围' : 'Scope'}: ${label}`,
    ...(turn.status === 'complete'
      ? []
      : [
          zh
            ? '此回答未完整生成，请核对原文。'
            : 'This answer is incomplete. Check the source text.',
        ]),
    `## ${zh ? '问题' : 'Question'}`,
    turn.question,
    `## ${zh ? '回答' : 'Answer'}`,
    turn.answer,
    ...(turn.sources.length
      ? [
          `## ${zh ? '参考原文' : 'Source passages'}`,
          ...turn.sources.map(
            (source) =>
              `### [${plainLine(source.id)}] ${plainLine(source.chapter)}\n\n${quote(source.text)}`,
          ),
        ]
      : []),
    zh
      ? '由 ByPage 导出。AI 可能出错，请核对原文。'
      : 'Exported from ByPage. AI can make mistakes; check the source text.',
  ].join('\n\n');
  // Reject rather than truncate an answer or silently omit sources.
  if (new TextEncoder().encode(body).byteLength > 1024 * 1024) throw new Error('export_too_large');
  const file = new File(Paths.cache, `ByPage-answer-${Crypto.randomUUID()}.md`);
  try {
    file.create();
    file.write(body);
    check();
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/markdown',
      UTI: 'net.daringfireball.markdown',
      dialogTitle: zh ? '导出这条问答' : 'Export this answer',
    });
    check();
  } finally {
    if (file.exists) file.delete();
  }
}
