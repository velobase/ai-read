'use client';

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact';

import { useI18n } from '@/lib/i18n/provider';
import { TranslationPromptEditor } from '@/components/reader/translation-prompt-editor';
import { ReadingNavigationSettings } from '@/components/reader/reading-controls';
import { ContentLanguageLabel } from '@/components/library/language-menu';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight, ArrowUpRight } from 'lucide-react';
import { useLibrary } from './library-provider';
import { Avatar, LibraryShell, PageHeading, SettingsRow } from './library-ui';
import { saveProfile } from '@/lib/library-state';
import { defaults, languages, type Settings } from '@/lib/types';
import { loadSettings, saveSettings } from '@/lib/storage';
import { readAIConnection, saveAIConnection, applyAIConnection } from '@/lib/ai-connection';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useIdentity } from '@/components/auth/identity-provider';

export function ProfilePage() {
  const { t, locale } = useI18n();
  const { user } = useIdentity();
  const { profile } = useLibrary();
  return (
    <LibraryShell>
      <main className="profile-page">
        <PageHeading title={t('我')} />
        <Link href={user ? '/me/profile' : '/login'} className="profile-identity">
          <Avatar />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold">
              {user ? profile.name : t('登录 ByPage · 逐页')}
            </h2>
            {user && <p>{user.email}</p>}
          </div>
          <ChevronRight size={20} className="text-muted-foreground" />
        </Link>
        {user?.isAdmin && (
          <div className="settings-group">
            <SettingsRow
              title={locale.startsWith('zh') ? '书城管理' : 'Bookstore admin'}
              href="/admin"
            />
          </div>
        )}
        <div className="settings-group">
          <SettingsRow title={t('账号与安全')} href="/me/account" />
          <SettingsRow title={t('阅读偏好')} href="/me/appearance" />
          <SettingsRow title={t('界面语言')} href="/me/language" />
          <SettingsRow title={t('AI 连接')} href="/me/models" />
        </div>
        <div className="settings-group">
          <SettingsRow title={t('数据与备份')} href="/me/data" />
          <SettingsRow title={t('诊断与隐私')} href="/me/diagnostics" />
          <SettingsRow title={t('关于 ByPage · 逐页')} href="/me/about" />
        </div>
      </main>
    </LibraryShell>
  );
}

export function EditProfilePage() {
  const { t } = useI18n();
  const { profile, refresh, notify } = useLibrary();
  const { user, refreshIdentity } = useIdentity();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(profile.name);
  useEffect(() => {
    setName(profile.name);
  }, [profile.name]);
  const changed = name.trim() !== profile.name;
  return (
    <LibraryShell hideNavigation>
      <main className="profile-page">
        <PageHeading title={t('个人资料')} back="/me" />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || saving) return;
            setSaving(true);
            try {
              const next = {
                name: name.trim().slice(0, 40),
                bio: profile.bio,
                color: profile.color,
              };
              if (user) {
                const response = await fetch('/api/account', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(next),
                });
                if (response.status === 401) {
                  await refreshIdentity();
                  return;
                }
                if (!response.ok) throw new Error();
                await refreshIdentity();
              } else {
                saveProfile(next);
                await refresh();
              }
              notify(t('个人资料已保存。'));
            } catch {
              notify(t('资料未能保存，请稍后重试。'));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="settings-form-card">
            <label className="settings-field">
              <span>{t('昵称')}</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                required
                placeholder={t('怎么称呼你')}
              />
            </label>
          </div>
          <div className="mt-6 flex gap-3">
            <Button
              className="h-11 flex-1 rounded-full"
              disabled={!changed || !name.trim() || saving}
            >
              {saving ? t('保存中…') : t('保存')}
            </Button>
          </div>
        </form>
      </main>
    </LibraryShell>
  );
}

export function PreferencesPage({ models = false }: { models?: boolean }) {
  const { t, text, locale } = useI18n();
  const isZh = locale.startsWith('zh');
  const { notify } = useLibrary();
  const { user, enabled: identityEnabled } = useIdentity();
  const [settings, setSettings] = useState<Settings>(defaults);
  const [hasKey, setHasKey] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const accountMode = identityEnabled && Boolean(user);
  const readOnly = !loaded || saving || (models && identityEnabled && !user);
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    const saved = loadSettings();
    setSettings(saved);
    if (!models) {
      setLoaded(true);
      return;
    }
    readAIConnection()
      .then((config) => {
        if (alive) {
          setHasKey(config.hasKey);
          setSettings((s) => applyAIConnection(s, config));
        }
      })
      .catch((error) => {
        console.error('ai.preferences.load', error);
        if (alive)
          notify(
            isZh
              ? '翻译服务暂时无法连接，请重试。'
              : 'Translation service unavailable. Please retry.',
          );
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [models, user?.id]);
  const patch = (value: Partial<Settings>) => setSettings((s) => ({ ...s, ...value }));
  const submit = async () => {
    if (readOnly) return;
    setSaving(true);
    try {
      let next = settings;
      if (models && accountMode) {
        const config = await saveAIConnection(settings);
        next = applyAIConnection(settings, config);
        setHasKey(config.hasKey);
        setSettings(next);
      }
      saveSettings(next);
      notify(t('设置已保存。'));
    } catch (error) {
      notify(error instanceof Error ? text(error.message) : t('设置保存失败，请重试。'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <LibraryShell hideNavigation>
      <main className="profile-page">
        <PageHeading title={models ? t('AI 连接') : t('阅读偏好')} back="/me" />
        {models && identityEnabled && !user && (
          <p className="mb-5 rounded-xl bg-primary/5 px-4 py-3 text-sm leading-7 text-muted-foreground">
            {t('登录后可使用 AI 翻译和伴读；原文阅读不受影响。')}{' '}
            <Link className="text-primary" href="/login?returnTo=%2Fme%2Fmodels">
              {t('登录')}
            </Link>
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {models ? (
            <>
              <div className="settings-form-card">
                <p role="status" className="text-sm">
                  {!loaded
                    ? isZh
                      ? '连接中…'
                      : 'Connecting…'
                    : hasKey
                      ? isZh
                        ? '翻译服务已就绪'
                        : 'Translation service ready'
                      : isZh
                        ? '请登录，或稍后重试连接服务。'
                        : 'Please sign in, or retry the service later.'}
                </p>
              </div>
              <div className="settings-form-card mt-4">
                <TranslationPromptEditor
                  value={settings.translationPrompt}
                  onChange={(translationPrompt) => patch({ translationPrompt })}
                  disabled={readOnly}
                />
              </div>
              <p className="my-5 text-xs leading-6 text-muted-foreground">
                {isZh
                  ? '只有使用翻译或伴读时，相关原文与问题才会发送到 LeafRead 的模型服务商。'
                  : 'When you use translation or the companion, relevant passages and questions are sent to LeafRead’s model provider.'}
              </p>
            </>
          ) : (
            <>
              <div
                className="appearance-preview"
                style={{
                  fontSize: settings.fontSize,
                  lineHeight: settings.lineHeight,
                  fontFamily:
                    settings.fontFamily === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)',
                  background: settings.theme === 'night' ? '#252628' : 'white',
                  color: settings.theme === 'night' ? '#c5c6ca' : '#373a40',
                }}
              >
                {t('阅读的意义，也许就在于：')}
                <br />
                {t('让一个新的想法，慢慢走进生活。')}
              </div>
              <div className="settings-form-card">
                <ReadingNavigationSettings settings={settings} update={patch} />
                <label className="settings-field">
                  <span>
                    {t('字号')}{' '}
                    <b className="ms-auto font-normal text-muted-foreground">{settings.fontSize}</b>
                  </span>
                  <Slider
                    aria-label={t('字号')}
                    min={15}
                    max={26}
                    step={1}
                    value={[settings.fontSize]}
                    onValueChange={([fontSize]) => patch({ fontSize })}
                  />
                </label>
                <label className="settings-field">
                  <span>
                    {t('行距')}{' '}
                    <b className="ms-auto font-normal text-muted-foreground">
                      {settings.lineHeight.toFixed(1)}
                    </b>
                  </span>
                  <Slider
                    aria-label={t('行距')}
                    min={1.5}
                    max={2.4}
                    step={0.1}
                    value={[settings.lineHeight]}
                    onValueChange={([lineHeight]) => patch({ lineHeight })}
                  />
                </label>
                <div className="settings-field">
                  <span>{t('字体')}</span>
                  <div className="flex gap-3">
                    {[
                      ['system', t('系统字体')],
                      ['serif', t('衬线字体')],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={settings.fontFamily === value}
                        onClick={() => patch({ fontFamily: value as Settings['fontFamily'] })}
                        className={cn(
                          'preference-option',
                          settings.fontFamily === value && 'active',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-field">
                  <span>{t('主题')}</span>
                  <div className="flex gap-3">
                    {[
                      ['paper', t('日间')],
                      ['night', t('夜间')],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={settings.theme === value}
                        onClick={() => patch({ theme: value as Settings['theme'] })}
                        className={cn('preference-option', settings.theme === value && 'active')}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-field">
                  <span>{t('默认阅读模式')}</span>
                  <Select
                    value={settings.readingMode}
                    onValueChange={(readingMode) =>
                      patch({ readingMode: readingMode as Settings['readingMode'] })
                    }
                  >
                    <SelectTrigger className="w-full" aria-label={t('默认阅读模式')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">{t('原文')}</SelectItem>
                      <SelectItem value="bilingual">{t('双语')}</SelectItem>
                      <SelectItem value="translation">
                        {locale.startsWith('zh') ? '仅译文' : 'Translation only'}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
          {!models && (
            <div className="settings-form-card mt-4">
              <div className="settings-field">
                <span>{t('翻译与回答语言')}</span>
                <Select value={settings.language} onValueChange={(language) => patch({ language })}>
                  <SelectTrigger className="w-full" aria-label={t('翻译与回答语言')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {languages.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        <ContentLanguageLabel code={value} nativeName={label} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <Button className="mt-6 h-12 w-full rounded-full" disabled={readOnly} type="submit">
            {saving ? (isZh ? '正在保存…' : 'Saving…') : t('保存设置')}
          </Button>
        </form>
      </main>
    </LibraryShell>
  );
}

export function AboutPage() {
  const { t, locale } = useI18n();
  const isZh = locale.startsWith('zh');
  return (
    <LibraryShell hideNavigation>
      <main className="profile-page">
        <PageHeading title={t('关于 ByPage · 逐页')} back="/me" />
        <div className="settings-form-card space-y-6 text-sm leading-8 text-muted-foreground">
          <div className="space-y-3">
            <a
              href="https://leafread.ai"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-primary"
            >
              {isZh ? '官方网站 · leafread.ai' : 'Official website · leafread.ai'}
              <ArrowUpRight size={16} />
            </a>
            <a href={SUPPORT_MAILTO} className="flex items-center gap-2 text-primary">
              {isZh ? '联系支持' : 'Support'} · {SUPPORT_EMAIL}
            </a>
            <div className="flex flex-wrap gap-5 pt-1">
              <Link href="/privacy" className="text-primary hover:underline">
                {isZh ? '隐私政策' : 'Privacy Policy'}
              </Link>
              <Link href="/terms" className="text-primary hover:underline">
                {isZh ? '服务条款' : 'Terms of Service'}
              </Link>
            </div>
          </div>
        </div>
        <p className="my-8 text-center text-xs text-muted-foreground">© 2026 LeafRead</p>
      </main>
    </LibraryShell>
  );
}
