'use client';

import { useId } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_TRANSLATION_PROMPT,
  MAX_TRANSLATION_PROMPT_LENGTH,
  effectiveTranslationPrompt,
  translationPresets,
} from '@/lib/translation-prompt';

export function TranslationPromptEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith('zh');
  const id = useId();
  const prompt = effectiveTranslationPrompt(value);
  const preset =
    translationPresets.find((item) => effectiveTranslationPrompt(item.prompt) === prompt)?.id ||
    'custom';
  return (
    <section className="space-y-3 border-t border-border pt-5" aria-labelledby={`${id}-label`}>
      <div className="flex items-center justify-between gap-3">
        <label id={`${id}-label`} htmlFor={id} className="text-sm font-medium">
          {zh ? '翻译 Prompt' : 'Translation prompt'}
        </label>
        <Select
          value={preset}
          disabled={disabled}
          onValueChange={(value) => {
            const next = translationPresets.find((item) => item.id === value);
            if (next) onChange(effectiveTranslationPrompt(next.prompt));
          }}
        >
          <SelectTrigger
            className="h-8 w-auto min-w-28 text-xs"
            aria-label={zh ? '翻译风格' : 'Translation style'}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {translationPresets.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {zh ? item.zh : item.en}
              </SelectItem>
            ))}
            {preset === 'custom' && (
              <SelectItem value="custom">{zh ? '自定义' : 'Custom'}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        id={id}
        name="translationPrompt"
        value={value}
        placeholder={DEFAULT_TRANSLATION_PROMPT}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        maxLength={MAX_TRANSLATION_PROMPT_LENGTH}
        rows={10}
        spellCheck={false}
        className="resize-y text-sm leading-6"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {'{{to}}'} {zh ? '目标语言' : 'target language'} · {'{{from}}'}{' '}
          {zh ? '原文语言' : 'source language'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || value === DEFAULT_TRANSLATION_PROMPT}
          onClick={() => onChange(DEFAULT_TRANSLATION_PROMPT)}
        >
          {zh ? '恢复默认' : 'Reset to default'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {zh ? '应用于新译本' : 'Applies to new editions'}
      </p>
    </section>
  );
}
