import { Text, View } from 'react-native';
import { bookSourceLanguages, safeReadingQuote } from '@bypage/reading-core';
import { useApp } from '../context';
import type { SpeechPlan, SpeechScope, SpeechSource } from '../adapters/speech-plan';
import type { useReaderSpeech } from './use-reader-speech';
import { Button, Chip, IconButton, SectionLabel, styles } from './ui';

export function ReaderSpeechPanel({
  speech,
  plan,
  scope,
  source,
  targetLanguage,
  selectionAvailable = false,
  onScope,
  onSource,
  onStart,
  onShowPassage,
}: {
  speech: ReturnType<typeof useReaderSpeech>;
  plan: SpeechPlan;
  scope: SpeechScope;
  source: SpeechSource;
  targetLanguage: string;
  selectionAvailable?: boolean;
  onScope: (scope: SpeechScope) => void;
  onSource: (source: SpeechSource) => void;
  onStart: () => void;
  onShowPassage: () => void;
}) {
  const { colors, t, preferences, patch } = useApp();
  const state = speech.state;
  const active = ['loading', 'speaking', 'paused'].includes(state.status);
  const current = state.current;
  const ready = plan.segments.filter((segment) => segment.chunks.length > 0).length;
  const status =
    state.status === 'loading'
      ? 'speechLoading'
      : state.status === 'speaking'
        ? 'speechSpeaking'
        : state.status === 'paused'
          ? 'speechPaused'
          : state.status === 'complete'
            ? 'speechComplete'
            : null;
  const preview = current && state.status !== 'idle' ? current : plan.segments[0];
  const previewStart = preview?.startOffset || 0;
  const previewEnd = preview?.endOffset || 0;
  const rangeLength = current ? current.endOffset - current.startOffset : 0;
  const progress =
    current && rangeLength > 0
      ? Math.round(
          Math.max(0, Math.min(1, (current.textOffset - current.startOffset) / rangeLength)) * 100,
        )
      : 0;
  return (
    <View style={{ gap: 15 }}>
      {status && (
        <View style={styles.spread}>
          <Text accessibilityRole="header" style={{ color: colors.accent, fontWeight: '600' }}>
            {t(status)}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {t('speechProgress', { current: state.ordinal, total: state.total })}
          </Text>
        </View>
      )}
      {(preview || plan.firstMissing) && (
        <View style={{ gap: 9, backgroundColor: colors.soft, borderRadius: 12, padding: 14 }}>
          <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
            {preview?.chapterTitle || plan.firstMissing?.chapterTitle}
            {preview
              ? ` · ${t(preview.source === 'translation' ? 'translation' : 'original')}`
              : ''}
          </Text>
          {!!preview?.text && (
            <Text numberOfLines={4} style={{ color: colors.ink, fontSize: 16, lineHeight: 25 }}>
              {safeReadingQuote(
                preview.text,
                previewStart,
                Math.min(600, previewEnd - previewStart),
              )}
            </Text>
          )}
          {current && state.status !== 'idle' && !!current.text && (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View style={{ height: 3, flex: 1, backgroundColor: colors.border }}>
                <View
                  style={{ height: 3, width: `${progress}%`, backgroundColor: colors.accent }}
                />
              </View>
              <Text style={{ fontSize: 11, color: colors.muted }}>{progress}%</Text>
            </View>
          )}
        </View>
      )}
      {state.reason === 'speech-error' && (
        <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
          {t('speechError')}
        </Text>
      )}
      {state.reason === 'missing-translation' && (
        <Text accessibilityRole="alert" style={{ color: colors.muted, lineHeight: 22 }}>
          {t('speechMissingStopped')}
        </Text>
      )}
      {current && state.status !== 'idle' && (
        <>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 18,
            }}
          >
            <IconButton
              icon="play-skip-back"
              label={t('speechPrevious')}
              disabled={!state.canPrevious}
              onPress={() => void speech.previous()}
            />
            {active && (
              <View style={{ flex: 1 }}>
                <Button
                  icon={state.status === 'paused' ? 'play' : 'pause'}
                  onPress={() =>
                    void (state.status === 'paused' ? speech.resume() : speech.pause())
                  }
                >
                  {t(state.status === 'paused' ? 'speechResume' : 'speechPause')}
                </Button>
              </View>
            )}
            <IconButton
              icon="play-skip-forward"
              label={t('speechNext')}
              disabled={!state.canNext}
              onPress={() => void speech.next()}
            />
          </View>
          {!!current.text && (
            <Button secondary icon="locate-outline" onPress={onShowPassage}>
              {t('speechShowPassage')}
            </Button>
          )}
        </>
      )}
      {active ? (
        <Button secondary icon="stop" onPress={() => void speech.stop()}>
          {t('stop')}
        </Button>
      ) : (
        <>
          <SectionLabel>{t('speechSource')}</SectionLabel>
          <View style={styles.row}>
            <Chip active={source === 'original'} onPress={() => onSource('original')}>
              {t('original')}
            </Chip>
            <Chip active={source === 'translation'} onPress={() => onSource('translation')}>
              {t('speechSavedTranslation')}
            </Chip>
          </View>
          {source === 'translation' && (
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {t('translationLanguage')} ·{' '}
              {bookSourceLanguages.find(([code]) => code === targetLanguage)?.[1] || targetLanguage}
            </Text>
          )}
          <SectionLabel>{t('speechScope')}</SectionLabel>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {selectionAvailable && (
              <Chip active={scope === 'selection'} onPress={() => onScope('selection')}>
                {t('speechSelectedText')}
              </Chip>
            )}
            <Chip active={scope === 'paragraph'} onPress={() => onScope('paragraph')}>
              {t('speechThisPassage')}
            </Chip>
            <Chip active={scope === 'chapter'} onPress={() => onScope('chapter')}>
              {t('speechRestOfChapter')}
            </Chip>
          </View>
          {plan.selectionUnavailable && (
            <Text accessibilityRole="alert" style={{ color: colors.muted, lineHeight: 22 }}>
              {t('speechSelectionUnavailable')}
            </Text>
          )}
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
            {t('speechRangeCount', { ready, total: plan.totalParagraphs })}
          </Text>
          {!!plan.missingCount && (
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
              {t('speechMissingHint', { count: plan.missingCount })}
            </Text>
          )}
          <SectionLabel>{t('speed')}</SectionLabel>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {[0.7, 0.9, 1.1, 1.3].map((speechRate) => (
              <Chip
                key={speechRate}
                active={preferences.speechRate === speechRate}
                onPress={() => patch({ speechRate })}
              >{`${speechRate}×`}</Chip>
            ))}
          </View>
          <Button icon="headset-outline" disabled={!ready} onPress={onStart}>
            {t('speechStart')}
          </Button>
        </>
      )}
    </View>
  );
}
