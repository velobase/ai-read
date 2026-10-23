'use client';

import { useI18n } from '@/lib/i18n/provider';
import { TranslationPromptEditor } from './translation-prompt-editor';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Fragment, useState, type ReactNode } from 'react';
import type { Settings } from '@/lib/types';

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
  onSave: (settings: Settings) => Promise<void>;
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
            await onSave(draft);
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
  const allowed = new Set(sources);
  const citation = (id: string, key: number) => (
    <Button
      variant="plain"
      size="plain"
      key={key}
      className="mx-[3px] inline-flex items-center justify-center rounded-sm bg-accent px-1 align-baseline text-[9px] leading-[1.7] text-primary hover:bg-accent/80 "
      onClick={() => navigate(id)}
      title={t('查看原文 {value0}', { value0: id })}
    >
      {id}
    </Button>
  );
  const citations = (value: string) =>
    value.split(/(\[[^\[\]\r\n]+\])(?!\()/g).map((part, i) => {
      if (part.startsWith('[') && part.endsWith(']')) {
        const body = part.slice(1, -1);
        if (/[\/\\]|(?:^|[\s,，;；])(?:mailto:|https?:|www\.)/i.test(body)) return part;
        const tokens = body.split(/([,，;；])/);
        // Split only explicit list separators. URLs and ranges are never expanded
        // or interpreted as IDs; every complete token still needs an exact match.
        if (!tokens.some((token, index) => index % 2 === 0 && allowed.has(token.trim())))
          return part;
        if (tokens.length === 1) return citation(tokens[0].trim(), i);
        return (
          <Fragment key={i}>
            {'['}
            {tokens.map((token, index) => {
              const id = token.trim();
              return index % 2 === 0 && allowed.has(id) ? (
                <Fragment key={index}>
                  {token.slice(0, token.indexOf(id))}
                  {citation(id, index)}
                  {token.slice(token.indexOf(id) + id.length)}
                </Fragment>
              ) : (
                token
              );
            })}
            {']'}
          </Fragment>
        );
      }
      return part;
    });
  const inline = (value: string) =>
    value
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i}>{citations(part.slice(2, -2))}</strong>
        ) : (
          <Fragment key={i}>{citations(part)}</Fragment>
        ),
      );
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
