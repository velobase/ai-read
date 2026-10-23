import { ActivityIndicator, Text, View } from 'react-native';
import { bookSourceLanguages, translationErrorMessage, type Book } from '@bypage/reading-core';
import { useAccount } from '../adapters/account';
import { useApp } from '../context';
import { useChapterTranslation } from './use-chapter-translation';
import { Button, Chip, SectionLabel, styles } from './ui';

export function TranslationPreparation({
  translation,
  wholeBookOnly = false,
}: {
  translation: ReturnType<typeof useChapterTranslation>;
  wholeBookOnly?: boolean;
}) {
  const { colors, preferences, openAccount, t } = useApp(),
    account = useAccount();
  const zh = preferences.locale === 'zh-CN',
    work = translation.work;
  const outdated = !!work && !!translation.sourceHash && work.sourceHash !== translation.sourceHash;
  const active = !outdated && work?.state === 'active';
  const completed = work?.chapters.filter((c) => c.state === 'ready').length || 0;
  const chunks = work?.chapters.reduce((n, c) => n + c.completedChunks, 0) || 0;
  const totalChunks =
    work?.chapters.filter((c) => c.state !== 'missing').reduce((n, c) => n + c.totalChunks, 0) || 0;
  const error = translation.error || work?.error;
  return (
    <View style={{ gap: 14 }}>
      <SectionLabel>{zh ? '翻译' : 'Translation'}</SectionLabel>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        {t('translationLanguage')} ·{' '}
        {bookSourceLanguages.find(([code]) => code === preferences.language)?.[1] ||
          preferences.language}
      </Text>
      {translation.sameLanguage ? (
        <Text style={{ color: colors.muted }}>{t('translationSameLanguage')}</Text>
      ) : (
        <>
          {!wholeBookOnly && (
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Chip
                active={translation.scope === 'chapter'}
                onPress={() => translation.setScope('chapter')}
              >
                {zh ? '本章' : 'This chapter'}
              </Chip>
              <Chip
                active={translation.scope === 'book'}
                onPress={() => translation.setScope('book')}
              >
                {zh ? '整本' : 'Whole book'}
              </Chip>
            </View>
          )}
          <Text style={{ color: colors.ink, lineHeight: 22 }}>
            {zh
              ? `${translation.ready} / ${translation.total} 章译文已完成`
              : `${translation.ready} / ${translation.total} chapters ready`}
          </Text>
          {!!work && !outdated && (
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
              {active
                ? zh
                  ? `服务端翻译中 · ${chunks} / ${totalChunks} 部分完成`
                  : `Translating on server · ${chunks} / ${totalChunks} parts complete`
                : work.state === 'paused'
                  ? zh
                    ? '任务已暂停，完成的章节和断点均已保留。'
                    : 'Paused. Completed chapters and checkpoints are saved.'
                  : work.state === 'error'
                    ? zh
                      ? '任务遇到错误，可从断点重试。'
                      : 'Task failed. Retry from the saved checkpoint.'
                    : zh
                      ? `已完成 ${completed} 章`
                      : `${completed} chapters complete`}
            </Text>
          )}
          {translation.loading && <ActivityIndicator color={colors.accent} />}
          {!!error && (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
                {translationErrorMessage(error, preferences.locale)}
              </Text>
              <Button
                secondary
                disabled={translation.busy}
                onPress={() => void translation.refresh()}
              >
                {t('retry')}
              </Button>
            </View>
          )}
          {outdated && error !== 'translation_source_changed' && (
            <Text style={{ color: colors.muted, lineHeight: 22 }}>
              {translationErrorMessage('translation_source_changed', preferences.locale)}
            </Text>
          )}
          {!account.session ? (
            <Button onPress={openAccount}>{zh ? '登录并翻译' : 'Sign in to translate'}</Button>
          ) : active ? (
            <View style={{ gap: 10 }}>
              <Button
                secondary
                icon="pause"
                busy={translation.busy}
                onPress={() => void translation.stop()}
              >
                {t('pauseTranslation')}
              </Button>
              {translation.scope === 'book' &&
                work?.chapters.some((c) => c.state === 'missing') && (
                  <Button disabled={translation.busy} onPress={() => void translation.start()}>
                    {zh ? '翻译整本' : 'Translate whole book'}
                  </Button>
                )}
            </View>
          ) : outdated ? (
            <Button busy={translation.busy} onPress={() => void translation.create()}>
              {zh ? '创建新译本' : 'Create new edition'}
            </Button>
          ) : translation.ready < translation.total ||
            work?.state === 'paused' ||
            work?.state === 'error' ? (
            <Button
              busy={translation.busy}
              disabled={translation.loading}
              icon="language-outline"
              onPress={() => void translation.start()}
            >
              {work?.state === 'paused'
                ? zh
                  ? '继续翻译'
                  : 'Resume translation'
                : work?.state === 'error'
                  ? zh
                    ? '重试翻译'
                    : 'Retry translation'
                  : translation.scope === 'book'
                    ? zh
                      ? '翻译整本'
                      : 'Translate whole book'
                    : zh
                      ? '翻译本章'
                      : 'Translate this chapter'}
            </Button>
          ) : null}
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
            {zh
              ? '登录后使用 LeafRead 提供的翻译，无需 Key，本版不收费。开始后会将本书原文提交到服务端处理；不需要开启书库同步。任务在后台继续，锁屏或离开 App 也不会中断。完整章节下载后可离线阅读。'
              : 'Sign in to translate with LeafRead. No API key or payment is required. Starting submits this book’s source text for server processing without enabling library sync. Work continues after locking your phone or leaving the app. Downloaded chapters are available offline.'}
          </Text>
          {!!work && (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {zh
                  ? `本机已保存所选范围 ${translation.cached} 章`
                  : `${translation.cached} chapters in this range saved offline`}
              </Text>
              {translation.manifest.editions.length > 1 &&
                translation.manifest.editions.map((edition) => (
                  <Button
                    key={edition.id}
                    secondary
                    disabled={
                      translation.busy ||
                      edition.id === translation.manifest.selectedId ||
                      edition.sourceHash !== translation.sourceHash ||
                      (edition.createdAt > (translation.edition?.createdAt || 0) &&
                        edition.chapters.some((c) => c.state !== 'ready'))
                    }
                    onPress={() => void translation.select(edition.id)}
                  >
                    {`${edition.id === translation.manifest.selectedId ? (zh ? '当前译本' : 'Current edition') : zh ? '切换译本' : 'Use edition'} · ${new Date(edition.createdAt).toLocaleDateString()} · ${edition.chapters.filter((c) => c.state === 'ready').length}/${edition.chapters.length}`}
                  </Button>
                ))}
              {account.session && !active && !outdated && !translation.loading && (
                <Button
                  secondary
                  disabled={translation.busy}
                  onPress={() => void translation.create()}
                >
                  {zh ? '重新翻译整本，保留当前译本' : 'Create a new whole-book edition'}
                </Button>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}
export function BookTranslationPreparation({ book }: { book: Book }) {
  const { colors } = useApp();
  const translation = useChapterTranslation(book, undefined, undefined, { defaultScope: 'book' });
  return (
    <View style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 14 }}>
      <TranslationPreparation translation={translation} wholeBookOnly />
    </View>
  );
}
