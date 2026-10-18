'use client';

import { useI18n } from '@/lib/i18n/provider';
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
import { type ReactNode } from 'react';
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
  onSave,
  close,
}: {
  settings: Settings;
  hasServerKey: boolean;
  onSave: (settings: Settings) => void;
  close: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal title={t('AI 连接设置')} close={close}>
      <p className="mb-[25px] mt-[13px] text-xs leading-[1.9] text-muted-foreground">
        {t('连接你自己的模型，用熟悉的语言探索书里的世界。')}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          onSave({
            ...settings,
            baseUrl: String(form.get('baseUrl')).trim(),
            model: String(form.get('model')).trim(),
            apiKey: String(form.get('apiKey')).trim(),
            language: String(form.get('language')),
          });
          close();
        }}
      >
        <label className="mb-[19px] block [&>span]:mb-2 [&>span]:flex [&>span]:items-center [&>span]:gap-[7px] [&>span]:text-[11px] [&>span]:font-medium [&>span]:text-muted-foreground [&_em]:ms-auto [&_em]:text-[9px] [&_em]:not-italic [&_em]:text-muted-foreground [&_small]:mt-[6px] [&_small]:block [&_small]:text-[10px] [&_small]:leading-[1.7] [&_small]:text-muted-foreground">
          <span>
            <Globe2 size={15} />
            {t('服务地址')}
          </span>
          <Input
            name="baseUrl"
            type="url"
            required
            defaultValue={settings.baseUrl}
            placeholder="https://your-provider.com/v1"
          />
          <small>{t('支持 OpenAI 兼容服务；本机 Ollama 可填 http://localhost:11434/v1。')}</small>
        </label>
        <label className="mb-[19px] block [&>span]:mb-2 [&>span]:flex [&>span]:items-center [&>span]:gap-[7px] [&>span]:text-[11px] [&>span]:font-medium [&>span]:text-muted-foreground [&_em]:ms-auto [&_em]:text-[9px] [&_em]:not-italic [&_em]:text-muted-foreground [&_small]:mt-[6px] [&_small]:block [&_small]:text-[10px] [&_small]:leading-[1.7] [&_small]:text-muted-foreground">
          <span>
            <Settings2 size={15} />
            {t('模型名称')}
          </span>
          <Input
            name="model"
            required
            defaultValue={settings.model}
            placeholder={t('填写服务商提供的模型 ID')}
          />
        </label>
        <label className="mb-[19px] block [&>span]:mb-2 [&>span]:flex [&>span]:items-center [&>span]:gap-[7px] [&>span]:text-[11px] [&>span]:font-medium [&>span]:text-muted-foreground [&_em]:ms-auto [&_em]:text-[9px] [&_em]:not-italic [&_em]:text-muted-foreground [&_small]:mt-[6px] [&_small]:block [&_small]:text-[10px] [&_small]:leading-[1.7] [&_small]:text-muted-foreground">
          <span>
            <KeyRound size={15} /> API Key <em>{t('可选')}</em>
          </span>
          <Input
            name="apiKey"
            type="password"
            autoComplete="off"
            defaultValue={settings.apiKey}
            placeholder={
              hasServerKey
                ? t('服务端已配置；留空使用服务端密钥')
                : t('只保留在当前页面，刷新后清除')
            }
          />
          <small>{t('密钥不写入浏览器存储。切换服务地址后，服务端密钥不会转发给新地址。')}</small>
        </label>
        <label className="mb-[19px] block [&>span]:mb-2 [&>span]:flex [&>span]:items-center [&>span]:gap-[7px] [&>span]:text-[11px] [&>span]:font-medium [&>span]:text-muted-foreground [&_em]:ms-auto [&_em]:text-[9px] [&_em]:not-italic [&_em]:text-muted-foreground [&_small]:mt-[6px] [&_small]:block [&_small]:text-[10px] [&_small]:leading-[1.7] [&_small]:text-muted-foreground">
          <span>{t('翻译与回答语言')}</span>
          <Select name="language" defaultValue={settings.language}>
            <SelectTrigger
              aria-label={t('翻译与回答语言')}
              className="w-full rounded-lg bg-background px-[11px] py-[10px] text-xs shadow-none data-[size=default]:h-auto dark:bg-background"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map(([id, label]) => (
                <SelectItem value={id} key={id} className="text-xs">
                  <ContentLanguageLabel code={id} nativeName={label} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="my-6 border-s-2 border-border bg-muted px-[13px] py-[10px] text-[10px] leading-[1.85] text-muted-foreground">
          {t('相关原文与问题会发送到所选模型，密钥不会同步。')}
        </div>
        <Button
          variant="default"
          size="plain"
          className="inline-flex items-center justify-center gap-[9px] rounded-lg bg-primary px-4 py-[11px] text-xs font-medium leading-[1.4] text-primary-foreground hover:bg-primary/90 w-full"
          type="submit"
        >
          {t('保存设置')}
          <ArrowUpRight size={17} />
        </Button>
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
