import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, TextInput, View } from 'react-native';
import {
  createPdfImportPreview,
  PDF_PREVIEW_PARAGRAPHS_PER_BATCH,
  type PdfImportReport,
} from '@bypage/reading-core';
import { useApp } from '../context';
import { useLibraryController } from '../library-controller';
import { Button, Chip, IconButton, styles } from './ui';

type Props = {
  report: PdfImportReport;
  disabled: boolean;
  isCurrent: () => boolean;
  compact?: boolean;
};
type Preview = ReturnType<typeof createPdfImportPreview>;
type Filter = 'all' | 'empty' | 'ocr';
type Selection = {
  filter: Filter;
  page: number | undefined;
  batch: number;
  input: string;
  error: boolean;
  scrollRevision: number;
};

/** Only four complete paragraphs are mounted; the remaining book stays in the report. */
export function PdfImportPreview(props: Props) {
  const identity = useRef({ report: props.report, revision: 0 });
  if (identity.current.report !== props.report)
    identity.current = { report: props.report, revision: identity.current.revision + 1 };
  const model = useMemo(() => createPdfImportPreview(props.report), [props.report]);
  // A fresh parse can have the same book ID and still contain different pages.
  return <PreviewPages key={identity.current.revision} {...props} model={model} />;
}

function PreviewPages({ model, disabled, isCurrent, compact = false }: Props & { model: Preview }) {
  const { colors, t } = useApp();
  const { blocked } = useLibraryController();
  const mounted = useRef(true);
  const access = useRef({ disabled, blocked, isCurrent });
  access.current = { disabled, blocked, isCurrent };
  const canInteract = () =>
    mounted.current &&
    !access.current.disabled &&
    !access.current.blocked &&
    access.current.isCurrent();
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const groups = useMemo(
    () => ({
      all: model.pages,
      empty: model.pages.filter((page) => page.method === 'empty'),
      ocr: model.pages.filter((page) => page.method === 'ocr'),
    }),
    [model],
  );
  const [selection, setSelection] = useState<Selection>(() => ({
    filter: 'all',
    page: model.pages[0]?.sourcePage,
    batch: 0,
    input: String(model.pages[0]?.sourcePage ?? ''),
    error: false,
    scrollRevision: 0,
  }));
  const latest = useRef(selection);
  latest.current = selection;
  const update = (next: Selection) => {
    if (!canInteract()) return;
    latest.current = next;
    setSelection(next);
  };
  const pickPage = (page: number | undefined, filter: Filter) => {
    Keyboard.dismiss();
    update({
      filter,
      page,
      batch: 0,
      input: String(page ?? ''),
      error: false,
      scrollRevision: latest.current.scrollRevision + 1,
    });
  };
  const go = () => {
    if (!canInteract()) return;
    const value = latest.current.input;
    const page = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(page) || !model.byPage.has(page)) {
      update({ ...latest.current, error: true });
      return;
    }
    pickPage(page, 'all');
  };
  const move = (delta: number) => {
    if (!canInteract()) return;
    const current = latest.current;
    const pages = groups[current.filter];
    const index = pages.findIndex((page) => page.sourcePage === current.page);
    const next = index >= 0 ? pages[index + delta] : undefined;
    if (next) pickPage(next.sourcePage, current.filter);
  };
  const changeBatch = (delta: number) => {
    if (!canInteract()) return;
    const current = latest.current;
    const page = current.page === undefined ? undefined : model.byPage.get(current.page);
    const next = current.batch + delta;
    if (page && next >= 0 && next * PDF_PREVIEW_PARAGRAPHS_PER_BATCH < page.paragraphs.length)
      update({ ...current, batch: next, scrollRevision: current.scrollRevision + 1 });
  };
  const pages = groups[selection.filter];
  const index = pages.findIndex((page) => page.sourcePage === selection.page);
  const page = selection.page === undefined ? undefined : model.byPage.get(selection.page);
  const start = selection.batch * PDF_PREVIEW_PARAGRAPHS_PER_BATCH;
  const paragraphs = page?.paragraphs.slice(start, start + PDF_PREVIEW_PARAGRAPHS_PER_BATCH) || [];
  const inactive = disabled || blocked;
  const filters: Filter[] = groups.ocr.length ? ['all', 'empty', 'ocr'] : ['all', 'empty'];

  return (
    <View style={{ flex: 1, minHeight: 0, gap: 8 }}>
      {!compact && (
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 8 }}
          >
            {filters.map((filter) => (
              <Chip
                key={filter}
                active={selection.filter === filter}
                disabled={inactive}
                onPress={() => {
                  if (!canInteract() || latest.current.filter === filter) return;
                  pickPage(groups[filter][0]?.sourcePage, filter);
                }}
              >
                {t(
                  filter === 'all'
                    ? 'pdfPreviewAll'
                    : filter === 'empty'
                      ? 'pdfPreviewEmpty'
                      : 'pdfPreviewOcr',
                  { n: groups[filter].length },
                )}
              </Chip>
            ))}
          </ScrollView>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <IconButton
          icon="chevron-back"
          label={t('pdfPreviousPage')}
          disabled={inactive || index <= 0}
          onPress={() => move(-1)}
        />
        <TextInput
          accessibilityLabel={t('pdfPageInput')}
          keyboardType="number-pad"
          value={selection.input}
          editable={!inactive}
          maxLength={4}
          onChangeText={(input) => update({ ...latest.current, input, error: false })}
          onSubmitEditing={go}
          style={[
            styles.input,
            {
              flex: 1,
              minWidth: 55,
              textAlign: 'center',
              color: colors.ink,
              borderColor: selection.error ? colors.error : colors.border,
            },
          ]}
        />
        <Button secondary disabled={inactive || !selection.input} onPress={go}>
          {t('pdfPreviewGo')}
        </Button>
        <IconButton
          icon="chevron-forward"
          label={t('pdfNextPage')}
          disabled={inactive || index < 0 || index >= pages.length - 1}
          onPress={() => move(1)}
        />
      </View>
      {selection.error && (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.error, fontSize: 12, lineHeight: 18 }}
        >
          {t('pdfPreviewInvalidPage')}
        </Text>
      )}
      {page && !compact && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }}>
            {t('pdfPage', { n: page.sourcePage })}
          </Text>
          <Text style={{ flexShrink: 1, color: colors.muted, fontSize: 11, textAlign: 'right' }}>
            {t(
              page.method === 'ocr'
                ? 'pdfPreviewOcrMethod'
                : page.method === 'empty'
                  ? 'pdfPreviewEmptyMethod'
                  : 'pdfPreviewTextMethod',
            )}
          </Text>
        </View>
      )}
      <ScrollView
        key={selection.scrollRevision}
        style={{ flex: 1, minHeight: 0, backgroundColor: colors.background, borderRadius: 10 }}
        contentContainerStyle={{ padding: 14, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!inactive}
      >
        {!page ? (
          <Text style={{ color: colors.muted, lineHeight: 22 }}>{t('pdfPreviewNoPages')}</Text>
        ) : page.method === 'empty' ? (
          <Text style={{ color: colors.muted, lineHeight: 22 }}>{t('pdfPreviewNoText')}</Text>
        ) : (
          paragraphs.map((paragraph) => (
            <Text
              key={paragraph.id}
              style={{
                color: colors.ink,
                fontSize: 14,
                lineHeight: 24,
                fontWeight: paragraph.kind === 'heading' ? '600' : '400',
              }}
            >
              {paragraph.text}
            </Text>
          ))
        )}
      </ScrollView>
      {!!page?.paragraphs.length && !compact && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <IconButton
            icon="chevron-back-circle-outline"
            label={t('pdfPreviewPreviousParagraphs')}
            disabled={inactive || selection.batch === 0}
            onPress={() => changeBatch(-1)}
          />
          <Text style={{ flex: 1, color: colors.muted, textAlign: 'center', fontSize: 12 }}>
            {t('pdfPreviewParagraphRange', {
              from: start + 1,
              to: Math.min(start + PDF_PREVIEW_PARAGRAPHS_PER_BATCH, page.paragraphs.length),
              total: page.paragraphs.length,
            })}
          </Text>
          <IconButton
            icon="chevron-forward-circle-outline"
            label={t('pdfPreviewNextParagraphs')}
            disabled={
              inactive || start + PDF_PREVIEW_PARAGRAPHS_PER_BATCH >= page.paragraphs.length
            }
            onPress={() => changeBatch(1)}
          />
        </View>
      )}
    </View>
  );
}
