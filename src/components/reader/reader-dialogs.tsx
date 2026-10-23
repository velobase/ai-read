'use client';

import { useI18n } from '@/lib/i18n/provider';
import { TranslationPromptEditor } from './translation-prompt-editor';
import { ContentLanguageLabel } from '@/components/library/language-menu';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useEffect, useState, type ReactNode } from 'react';
import { readAIConnection, applyAIConnection } from '@/lib/ai-connection';
import { ArrowUpRight, Settings2, KeyRound, Globe2 } from 'lucide-react';
import type { Settings } from '@/lib/types';
import { languages } from '@/lib/types';

export function Modal({
  title,
  children,
  close,
  wide = false,
  mobileSheet = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  mobileSheet?: boolean;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          'max-h-[88dvh] w-[calc(100vw-30px)] gap-0 overflow-y-auto rounded-[15px] bg-card px-[30px] py-[26px] text-foreground shadow-[var(--shadow)] sm:max-w-[500px] max-[720px]:px-[21px] max-[720px]:py-[23px]',
          wide && 'sm:max-w-[820px]',
          mobileSheet &&
            'max-sm:top-auto max-sm:left-0 max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[max(28px,env(safe-area-inset-bottom))]',
        )}
      >
        {mobileSheet && (
          <div
            className="mx-auto mb-5 h-1 w-9 rounded-full bg-muted sm:hidden"
            aria-hidden="true"
          />
        )}
        <DialogHeader className="text-start">
          <DialogTitle className="pe-5 text-[19px] font-medium tracking-[0.3px] max-[720px]:text-[17px]">
            {title}
          </DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function SettingsModal({
  settings,
  hasServerKey,
  accountMode = false,
  onSave,
  close,
}: {
  settings: Settings;
  hasServerKey: boolean;
  accountMode?: boolean;
  onSave: (settings: Settings, clearKey: boolean) => Promise<void>;
  close: () => void;
}) {
  const { locale, t } = useI18n(),
    zh = locale.startsWith('zh');
  const [draft, setDraft] = useState(settings),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title={zh ? '翻译与伴读' : 'Translation & companion'} close={close}>
      <p className="my-5 text-sm leading-7 text-muted-foreground">
        {zh
          ? '登录即可使用 LeafRead 翻译服务，无需填写 API Key。'
          : 'Sign in to use LeafRead translation. No API key required.'}
      </p>
      {!hasServerKey && (
        <p className="mb-4 text-sm">
          {zh
            ? '服务暂时未连接，请登录或稍后重试。'
            : 'Please sign in, or retry the service later.'}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError('');
          try {
            await onSave(draft, false);
            close();
          } catch (error) {
            console.error('ai.preferences.save', error);
            setError(zh ? '保存失败，请重试。' : 'Unable to save. Please retry.');
          } finally {
            setSaving(false);
          }
        }}
      >
        <fieldset disabled={saving || !accountMode} className="space-y-5">
          <label className="block text-sm">
            {t('翻译与回答语言')}
            <select
              className="mt-2 block w-full rounded-lg border bg-background p-3"
              value={draft.language}
              onChange={(e) => setDraft({ ...draft, language: e.target.value })}
            >
              {languages.map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <TranslationPromptEditor
            value={draft.translationPrompt}
            onChange={(translationPrompt) => setDraft({ ...draft, translationPrompt })}
            disabled={saving}
          />
          <p className="text-xs leading-6 text-muted-foreground">
            {zh
              ? '使用翻译或伴读时，相关原文与问题会发送到 LeafRead 的模型服务商。'
              : 'When you translate or ask a question, relevant passages are sent to LeafRead’s model provider.'}
          </p>
          <Button type="submit" className="w-full">
            {saving ? (zh ? '保存中…' : 'Saving…') : t('保存设置')}
          </Button>
        </fieldset>
      </form>
    </Modal>
  );
}

export function Answer({
  content,
  sources = [],
  navigate,
}: {
  content: string;
  sources?: string[];
  navigate: (id: string) => void;
}) {
  const { t } = useI18n();
  // Render only text, emphasis and verified citation buttons. Model HTML is never executed.
  const inline = (value: string) =>
    value.split(/(\[\d+\.\d+\]|\*\*[^*]+\*\*)/g).map((part, i) => {
      if (/^\[\d+\.\d+\]$/.test(part)) {
        const id = part.slice(1, -1);
        return sources.includes(id) ? (
          <Button
            variant="plain"
            size="plain"
            key={i}
            className="mx-[3px] inline-flex items-center justify-center rounded-sm bg-accent px-1 align-baseline text-[9px] leading-[1.7] text-primary hover:bg-accent/80 "
            onClick={() => navigate(id)}
            title={t('查看原文 {value0}', { value0: id })}
          >
            {id}
          </Button>
        ) : (
          <span
            className="text-[10px] text-[#b18567]"
            key={i}
            title={t('引用未包含在本次提供的原文中')}
          >
            {part}?
          </span>
        );
      }
      return part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        part
      );
    });
  return (
    <div className="wrap-anywhere text-xs leading-[1.9] text-foreground group-data-[role=user]/message:rounded-[9px] group-data-[role=user]/message:border group-data-[role=user]/message:bg-muted group-data-[role=user]/message:px-3 group-data-[role=user]/message:py-[10px] group-data-[role=user]/message:text-foreground [&_p]:mb-[5px] [&_h4]:mb-[5px] [&_h4]:mt-3 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:text-foreground">
      {content.split('\n').map((line, i) =>
        line.startsWith('#') ? (
          <h4 key={i} dir="auto">
            {inline(line.replace(/^#+\s*/, ''))}
          </h4>
        ) : line.trim() ? (
          <p key={i} dir="auto">
            {inline(line)}
          </p>
        ) : (
          <div className="h-[7px]" key={i} />
        ),
      )}
    </div>
  );
}
