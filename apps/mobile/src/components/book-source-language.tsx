import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { bookSourceLanguages, effectiveBookLanguage, type Book } from '@bypage/reading-core';
import { useApp } from '../context';
import { Icon, Sheet, styles } from './ui';

export function BookSourceLanguage({
  book,
  update,
}: {
  book: Book;
  update?: (language: string) => Promise<void>;
}) {
  const { colors, t, notify } = useApp();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const language = effectiveBookLanguage(book);
  const selected = book.sourceLanguage || 'auto';
  const value = language === 'auto' ? t('sourceLanguageAuto') : language.toUpperCase();
  const filtered = bookSourceLanguages.filter(([code, name]) =>
    `${code} ${name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const choose = async (next: string) => {
    if (!update || saving !== null) return;
    if (next === selected) {
      setVisible(false);
      return;
    }
    setSaving(next);
    try {
      await update(next);
      setVisible(false);
    } catch {
      notify(t('error'));
    } finally {
      setSaving(null);
    }
  };
  const choice = (code: string, label: string) => (
    <Pressable
      key={code}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected === code, disabled: saving !== null }}
      disabled={saving !== null}
      onPress={() => void choose(code)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      <Text style={{ flex: 1, color: colors.ink, fontSize: 15 }}>{label}</Text>
      {saving === code ? (
        <ActivityIndicator color={colors.accent} />
      ) : selected === code ? (
        <Icon name="checkmark" color={colors.accent} />
      ) : null}
    </Pressable>
  );
  return (
    <>
      <Pressable
        accessibilityRole={update ? 'button' : undefined}
        accessibilityLabel={`${t('sourceLanguage')} · ${value}`}
        disabled={!update}
        onPress={() => {
          setQuery('');
          setVisible(true);
        }}
        style={{ alignItems: 'center', gap: 9 }}
      >
        <Text style={{ fontSize: 11, color: colors.muted }}>{t('original')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 21, color: update ? colors.accent : colors.ink }}>{value}</Text>
          {update && <Icon name="chevron-down" size={13} color={colors.accent} />}
        </View>
      </Pressable>
      {update && (
        <Sheet
          visible={visible}
          title={t('sourceLanguage')}
          close={() => saving === null && setVisible(false)}
        >
          <Text style={{ color: colors.muted, lineHeight: 22 }}>{t('sourceLanguageHint')}</Text>
          {choice('auto', t('sourceLanguageDefault'))}
          <TextInput
            accessibilityLabel={t('sourceLanguageSearch')}
            placeholder={t('sourceLanguageSearch')}
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            autoCapitalize="none"
            value={query}
            onChangeText={setQuery}
            style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
          />
          <View>{filtered.map(([code, name]) => choice(code, `${name} · ${code}`))}</View>
          {!filtered.length && <Text style={{ color: colors.muted }}>{t('noResults')}</Text>}
        </Sheet>
      )}
    </>
  );
}
