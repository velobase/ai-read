import { useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { bookSourceLanguages, type Book } from '@bypage/reading-core';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import type { TextKey } from '../i18n';
import {
  pauseTranslationQueue,
  subscribeTranslationQueue,
  translationQueueSnapshot,
  type TranslationJob,
} from '../adapters/translation-queue';
import { useChapterTranslation } from './use-chapter-translation';
import { Button, Chip, IconButton, SectionLabel, styles } from './ui';

const scopeLabels = {
  paragraph: 'translationScopeParagraph',
  chapter: 'aiScopeChapter',
  book: 'aiScopeBook',
} as const;
function jobMessage(job: TranslationJob): TextKey | null {
  if (job.busy) return null;
  if (job.reason === 'configuration') return 'translationConfigurationChanged';
  if (job.reason === 'timeout') return 'translationTimedOut';
  if (job.reason === 'batch') return 'translationBatchFinished';
  if (job.reason === 'account') return 'translationAccountPaused';
  if (job.reason === 'environment') return 'translationSettingsPaused';
  if (job.reason === 'background') return 'translationBackgroundPaused';
  if (job.status === 'paused') return 'translationPaused';
  if (job.status === 'complete') return 'translationTaskReady';
  if (job.error === 'translation_connection_required') return 'connectAiFirst';
  if (['native_ai_unavailable', 'unsupported_server_response'].includes(job.error || ''))
    return 'translationUnavailable';
  if (job.error) return 'translationFailed';
  return null;
}

export function TranslationPreparation({
  translation,
  wholeBookOnly = false,
}: {
  translation: ReturnType<typeof useChapterTranslation>;
  wholeBookOnly?: boolean;
}) {
  const { colors, t, preferences } = useApp();
  const job = translation.job;
  const message = job ? jobMessage(job) : null;
  const completedCurrentRange =
    job?.status === 'complete' &&
    job.scope === translation.scope &&
    job.firstParagraphId === translation.entries[0]?.paragraph.id &&
    job.lastParagraphId === translation.entries[translation.entries.length - 1]?.paragraph.id;
  return (
    <View style={{ gap: 14 }}>
      <SectionLabel>{t('translationPreparation')}</SectionLabel>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        {t('translationLanguage')} ·{' '}
        {bookSourceLanguages.find(([code]) => code === preferences.language)?.[1] ||
          preferences.language}
      </Text>
      {translation.otherBusy && (
        <View style={{ gap: 10, padding: 12, borderRadius: 10, backgroundColor: colors.soft }}>
          <Text style={{ color: colors.ink, lineHeight: 22 }}>{t('translationOtherBook')}</Text>
          <Text numberOfLines={2} style={{ color: colors.muted, lineHeight: 22 }}>
            {translation.globalJob?.title}
          </Text>
          <Button secondary icon="pause" onPress={translation.stop}>
            {t('pauseTranslation')}
          </Button>
        </View>
      )}
      {translation.sameLanguage ? (
        <Text style={{ color: colors.muted, lineHeight: 22 }}>{t('translationSameLanguage')}</Text>
      ) : (
        <>
          {!wholeBookOnly && (
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              {(['paragraph', 'chapter', 'book'] as const).map((scope) => (
                <Chip
                  key={scope}
                  active={translation.scope === scope}
                  onPress={() => {
                    if (!translation.busy) translation.setScope(scope);
                  }}
                >
                  {t(scopeLabels[scope])}
                </Chip>
              ))}
            </View>
          )}
          <Text style={{ color: colors.ink, lineHeight: 22 }}>
            {t('translationCount', { ready: translation.ready, total: translation.total })}
          </Text>
          {translation.loading && <ActivityIndicator color={colors.accent} />}
          {translation.loadError && (
            <>
              <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
                {t('translationLoadError')}
              </Text>
              <Button secondary onPress={() => void translation.refresh()}>
                {t('retry')}
              </Button>
            </>
          )}
          {!!job && (
            <View style={{ gap: 7 }}>
              <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
                {t('translationRunProgress', {
                  scope: t(scopeLabels[job.scope]),
                  done: job.done,
                  total: job.total,
                })}
              </Text>
              {!!job.current && (
                <Text
                  numberOfLines={2}
                  style={{
                    color: job.status === 'error' ? colors.error : colors.muted,
                    fontSize: 12,
                    lineHeight: 20,
                  }}
                >
                  {t('translationCurrentParagraph', {
                    n: job.current.ordinal,
                    chapter: job.current.chapter,
                  })}
                </Text>
              )}
              {!!message && (
                <Text
                  accessibilityRole={job.status === 'error' ? 'alert' : undefined}
                  style={{
                    color: job.status === 'error' ? colors.error : colors.muted,
                    lineHeight: 22,
                  }}
                >
                  {t(message)}
                </Text>
              )}
            </View>
          )}
          {job?.busy ? (
            <Button secondary icon="pause" busy={!!job.reason} onPress={translation.stop}>
              {t(job.reason ? 'translationPausing' : 'pauseTranslation')}
            </Button>
          ) : translation.batchCount > 0 ? (
            <Button
              disabled={translation.busy || translation.loading || translation.loadError}
              icon="language-outline"
              onPress={() => void translation.start()}
            >
              {t(job?.reason === 'batch' ? 'translationNextBatch' : 'prepareTranslation', {
                count: translation.batchCount,
              })}
            </Button>
          ) : !translation.loading &&
            !translation.loadError &&
            !translation.pendingCount &&
            !completedCurrentRange ? (
            <Text style={{ color: colors.muted }}>{t('translationReady')}</Text>
          ) : null}
          {job?.busy && job.total > 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
              {t('translationRunningServiceHint', { count: job.characters })}
            </Text>
          ) : !translation.busy && translation.batchCount > 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
              {t('translationServiceHint', { count: translation.characters })}
            </Text>
          ) : null}
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
            {t('translationQueueHint')}
          </Text>
        </>
      )}
    </View>
  );
}

/** The detail entry prepares the book; all committed text is shared with the reader. */
export function BookTranslationPreparation({ book }: { book: Book }) {
  const { colors } = useApp();
  const translation = useChapterTranslation(book, undefined, undefined, { defaultScope: 'book' });
  return (
    <View style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 14 }}>
      <TranslationPreparation translation={translation} wholeBookOnly />
    </View>
  );
}

/** Keep foreground work visible after leaving a reader or book detail screen. */
export function TranslationQueueBanner({ open }: { open: (bookId: string) => void }) {
  const { colors, t } = useApp();
  const lease = useLibrary();
  const snapshot = useSyncExternalStore(
    subscribeTranslationQueue,
    translationQueueSnapshot,
    translationQueueSnapshot,
  );
  const job = snapshot.lease === lease && lease.isCurrent() ? snapshot.job : null;
  if (!job?.busy) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 9,
        backgroundColor: colors.soft,
        borderTopWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      <ActivityIndicator color={colors.accent} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 13 }}>
          {job.title}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>
          {t('translationRunProgress', {
            scope: t(scopeLabels[job.scope]),
            done: job.done,
            total: job.total,
          })}
        </Text>
      </View>
      <IconButton
        icon="pause"
        label={t(job.reason ? 'translationPausing' : 'pauseTranslation')}
        disabled={!!job.reason}
        onPress={() => {
          if (lease.isCurrent()) pauseTranslationQueue(lease.handle);
        }}
      />
      <IconButton
        icon="chevron-forward"
        label={t('translationOpenBook')}
        onPress={() => {
          if (lease.isCurrent()) open(job.bookId);
        }}
      />
    </View>
  );
}
