import { Text, View } from 'react-native';
import type { RecoveryCounts, RecoveryRestoreResult } from '../adapters/library-recovery-restore';
import { useApp } from '../context';

export function recoveryReason(reason: string, zh: boolean): string {
  if (reason === 'local-book-deleted') return zh ? '本机删除前' : 'Before local deletion';
  if (reason === 'remote-book-deleted') return zh ? '云端删除前' : 'Before remote deletion';
  if (reason === 'remote-book-content-conflict')
    return zh ? '书籍内容冲突' : 'Book content conflict';
  if (reason.startsWith('conflict-')) return zh ? '同步冲突前' : 'Before a sync conflict';
  return zh ? '保存的恢复副本' : 'Saved recovery copy';
}

export function RecoveryCountsView({ counts }: { counts: RecoveryCounts }) {
  const { colors, preferences } = useApp();
  const zh = preferences.locale === 'zh-CN';
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.ink, lineHeight: 23 }}>
        {zh
          ? `笔记 ${counts.notes} · 书签 ${counts.bookmarks} · 译文段落 ${counts.translations}\nAI 历史 ${counts.history} · 翻译草稿 ${counts.drafts}`
          : `${counts.notes} notes · ${counts.bookmarks} bookmarks · ${counts.translations} translated paragraphs\n${counts.history} AI conversations · ${counts.drafts} translation drafts`}
      </Text>
      {((counts.translationVersions || 0) > 0 || (counts.translationSelections || 0) > 0) && (
        <Text style={{ color: colors.ink, lineHeight: 23 }}>
          {zh
            ? `精确译文版本 ${counts.translationVersions || 0} · 阅读选择 ${counts.translationSelections || 0}`
            : `${counts.translationVersions || 0} exact translation versions · ${counts.translationSelections || 0} reading selections`}
        </Text>
      )}
      {(counts.skippedHistory > 0 || counts.skippedDrafts > 0) && (
        <Text style={{ color: colors.error, lineHeight: 23 }}>
          {zh
            ? `${counts.skippedHistory} 条历史和 ${counts.skippedDrafts} 条草稿格式不兼容，不纳入恢复，仍保留在原归档中。`
            : `${counts.skippedHistory} conversations and ${counts.skippedDrafts} drafts are incompatible. They are skipped and remain in the original archive.`}
        </Text>
      )}
    </View>
  );
}

export function RecoveryResultView({ result }: { result: RecoveryRestoreResult }) {
  const { colors, preferences } = useApp();
  const zh = preferences.locale === 'zh-CN';
  const missingPdf = result.pdfOriginal === 'missing' || result.pdfOriginal === 'unavailable';
  return (
    <View style={{ gap: 12 }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.ink, fontSize: 19, fontWeight: '600' }}
      >
        {result.title}
      </Text>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.ink, lineHeight: 23 }}>
        {result.alreadyRestored
          ? zh
            ? '此归档已恢复到本机，沿用已有副本。'
            : 'This archive was already restored. Its existing device copy is kept.'
          : zh
            ? '已恢复为独立的本机副本。原书和归档仍保留。'
            : 'Restored as an independent device copy. The original book and archive are preserved.'}
      </Text>
      <RecoveryCountsView counts={result} />
      {result.pdfOriginal !== 'not-pdf' && (
        <Text style={{ color: missingPdf ? colors.error : colors.muted, lineHeight: 23 }}>
          {missingPdf
            ? zh
              ? '正文已恢复，PDF 原件未包含在此副本中；“查看原 PDF”暂不可用。'
              : 'Reading text is restored. The original PDF is not included, so viewing original pages is unavailable.'
            : zh
              ? 'PDF 原件已保留到本机副本。'
              : 'The original PDF is available in the device copy.'}
        </Text>
      )}
      {(result.history > 0 || result.drafts > 0) && (
        <Text style={{ color: colors.muted, lineHeight: 23 }}>
          {zh
            ? 'AI 历史和草稿保留原服务、账号及上下文标识；只有身份与上下文匹配时才可用于续接。'
            : 'AI conversations and drafts keep their original service, account and context identity. Continuing them requires a matching identity and context.'}
        </Text>
      )}
    </View>
  );
}
