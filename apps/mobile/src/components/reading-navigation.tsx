import { View } from 'react-native';
import { useApp, type Preferences } from '../context';
import { Chip } from './ui';

export function ReadingNavigation({
  onChange,
}: {
  onChange?: (change: Partial<Pick<Preferences, 'turnMode' | 'pageEffect' | 'scrollFlow'>>) => void;
} = {}) {
  const { preferences: prefs, patch, t } = useApp();
  const change = onChange || patch;
  return (
    <>
      <View accessibilityLabel={t('navigation')} style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Chip active={prefs.turnMode === 'paged'} onPress={() => change({ turnMode: 'paged' })}>
          {t('pageMode')}
        </Chip>
        <Chip active={prefs.turnMode === 'scroll'} onPress={() => change({ turnMode: 'scroll' })}>
          {t('scrollMode')}
        </Chip>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {prefs.turnMode === 'paged'
          ? (['curl', 'slide', 'none'] as const).map((pageEffect) => (
              <Chip
                key={pageEffect}
                active={prefs.pageEffect === pageEffect}
                onPress={() => change({ pageEffect })}
              >
                {t(pageEffect)}
              </Chip>
            ))
          : (['continuous', 'chapter'] as const).map((scrollFlow) => (
              <Chip
                key={scrollFlow}
                active={prefs.scrollFlow === scrollFlow}
                onPress={() => change({ scrollFlow })}
              >
                {t(scrollFlow === 'chapter' ? 'chapterScroll' : 'continuous')}
              </Chip>
            ))}
      </View>
    </>
  );
}
