'use client';

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact';

import { useI18n } from '@/lib/i18n/provider';
import { TranslationPromptEditor } from '@/components/reader/translation-prompt-editor';
import { ReadingNavigationSettings } from '@/components/reader/reading-controls';
import { ContentLanguageLabel } from '@/components/library/language-menu';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  NotebookPen,
  FolderHeart,
  SlidersHorizontal,
  ChevronRight,
  Sparkles,
  HardDrive,
  Info,
  Globe2,
  Save,
  Palette,
  ShieldCheck,
  ArrowUpRight,
  Download,
  Activity,
} from 'lucide-react';
import { useLibrary } from './library-provider';
import { Avatar, LibraryShell, PageHeading, SettingsRow } from './library-ui';
import { profileColors, saveProfile } from '@/lib/library-state';
import { defaults, languages, type Settings } from '@/lib/types';
import { loadSettings, saveSettings } from '@/lib/storage';
import { readAIConnection, saveAIConnection, applyAIConnection } from '@/lib/ai-connection';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  const { profile, books, notes, state, positions } = useLibrary();
  const reading = books.filter(
    (b) =>
      state.books[b.id]?.status === 'reading' ||
      (positions[b.id] && state.books[b.id]?.status !== 'finished'),
  ).length;
  const finished = books.filter((b) => state.books[b.id]?.status === 'finished').length;
  return (
    <LibraryShell>
      <main className="profile-page">
        <div className="profile-top-actions">
          <span className="text-sm text-muted-foreground">{t('我的阅读')}</span>
          <Link
            href="/me/settings"
            className="flex size-11 items-center justify-center"
            aria-label={t('设置')}
          >
            <SlidersHorizontal size={23} strokeWidth={1.6} />
          </Link>
        </div>
        <Link href={user ? '/me/profile' : '/login'} className="profile-identity">
          <Avatar />
          <div className="min-w-0 flex-1">
            <h1 className={user ? undefined : 'guest-brand-heading'}>
              {user ? profile.name : t('登录 ByPage · 逐页')}
            </h1>
            <p>
              {user ? profile.bio || t('在阅读里，遇见更大的世界。') : t('游客书库已保存在本机')}
            </p>
          </div>
          <ChevronRight size={22} className="text-muted-foreground/50" />
        </Link>
        {user?.isAdmin && (
          <Link
            className="mb-5 block rounded-xl bg-primary/10 p-4 text-sm font-medium text-primary"
            href="/admin"
          >
            {locale.startsWith('zh')
              ? '书城管理 · 上书与发布'
              : 'Bookstore admin · Upload & publish'}{' '}
            →
          </Link>
        )}
        <Link href="/library" className="profile-reading-card">
          <span className="profile-color-icon bg-[#edbd66]">
            <BookOpen size={22} />
          </span>
          <div>
            <h2>{t('我的书架')}</h2>
            <p>{t('每一本书，都是新的开始')}</p>
          </div>
          <strong>
            {books.length.toLocaleString(locale)}{' '}
            <small>{books.length === 1 && !locale.startsWith('zh') ? 'Book' : t('本')}</small>
          </strong>
          <ChevronRight size={17} className="text-muted-foreground/50" />
        </Link>
        <div className="profile-stats-grid">
          {[
            {
              href: '/library?filter=reading',
              title: t('在读'),
              value: reading,
              unit: t('{count} 本书', { count: reading }),
              Icon: BookOpen,
              color: '#55c6ae',
            },
            {
              href: '/library?filter=finished',
              title: t('读完'),
              value: finished,
              unit: t('{count} 本书', { count: finished }),
              Icon: CheckCircle2,
              color: '#60bedb',
            },
            {
              href: '/notes',
              title: t('笔记'),
              value: notes.length,
              unit: t('{count} 条笔记', { count: notes.length }),
              Icon: NotebookPen,
              color: '#66b5e6',
            },
            {
              href: '/collections',
              title: t('分组'),
              value: state.groups.length,
              unit: `${state.groups.length.toLocaleString(locale)} ${
                !locale.startsWith('zh')
                  ? state.groups.length === 1
                    ? 'collection'
                    : 'collections'
                  : t('个分组')
              }`,
              Icon: FolderHeart,
              color: '#a58bdb',
            },
          ].map(({ href, title, unit, Icon, color }) => (
            <Link href={href} className="profile-stat" key={title}>
              <span className="profile-color-icon" style={{ background: color }}>
                <Icon size={21} />
              </span>
              <div>
                <h2>{title}</h2>
                <p>{unit}</p>
              </div>
            </Link>
          ))}
        </div>
        <div className="settings-group">
          <SettingsRow
            icon={<FolderHeart className="text-[#b28dd8]" size={23} />}
            title={t('书单与分组')}
            href="/collections"
            detail={t('{count} 个', { count: state.groups.length })}
          />
          <SettingsRow
            icon={<Palette className="text-[#df9b88]" size={23} />}
            title={t('阅读偏好')}
            href="/me/appearance"
          />
        </div>
        <div className="settings-group">
          <SettingsRow
            icon={<ShieldCheck className="text-[#81a896]" size={23} />}
            title={t('账号与安全')}
            href="/me/account"
            detail={user ? t('已登录') : t('游客')}
          />
          <SettingsRow
            icon={<Sparkles className="text-[#88a7df]" size={23} />}
            title={t('AI 连接')}
            href="/me/models"
          />
          <SettingsRow
            icon={<HardDrive className="text-[#8ba5b3]" size={23} />}
            title={t('数据与备份')}
            href="/me/data"
          />
          <SettingsRow
            icon={<Info className="text-[#b1b5bd]" size={23} />}
            title={t('关于 ByPage · 逐页')}
            href="/me/about"
          />
          <SettingsRow
            icon={<ShieldCheck className="text-[#7da3b8]" size={23} />}
            title={locale.startsWith('zh') ? '隐私政策与服务条款' : 'Privacy & Terms'}
            href="/privacy"
          />
        </div>
        <p className="profile-local-label">
          <ShieldCheck size={13} />
          {user
            ? t('账号已登录 · 书籍与笔记仅保存在当前浏览器')
            : t('游客阅读 · 已有书籍和笔记会完整保留')}
        </p>
        <p className="mt-2 text-center text-[10px] text-muted-foreground/70">
          © 2026 LeafRead ·{' '}
          <a
            href="https://leafread.ai"
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            leafread.ai
          </a>{' '}
          ·{' '}
          <a href={SUPPORT_MAILTO} className="hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </main>
    </LibraryShell>
  );
}

export function EditProfilePage() {
  const { t, locale } = useI18n();
  const { profile, refresh, notify } = useLibrary();
  const { user, refreshIdentity } = useIdentity();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [color, setColor] = useState(profile.color);
  useEffect(() => {
    setName(profile.name);
    setBio(profile.bio);
    setColor(profile.color);
  }, [profile.name, profile.bio, profile.color]);
  const changed =
    name.trim() !== profile.name || bio.trim() !== profile.bio || color !== profile.color;
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
              const next = { name: name.trim().slice(0, 40), bio: bio.trim().slice(0, 120), color };
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
          <div className="profile-edit-avatar">
            <Avatar name={name} color={color} />
            <span className="text-xs text-muted-foreground">{t('选一个喜欢的颜色')}</span>
            <div className="flex gap-4">
              {profileColors.map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-label={t('头像颜色 {value0}', { value0: profileColors.indexOf(c) + 1 })}
                  aria-pressed={color === c}
                  className={cn(
                    'size-7 rounded-full ring-offset-4 ring-offset-[#f5f5f7]',
                    color === c && 'ring-2 ring-primary',
                  )}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
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
              <small>{name.length.toLocaleString(locale)}/40</small>
            </label>
            <label className="settings-field">
              <span>{t('关于我')}</span>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={120}
                placeholder={t('写一句此刻的想法')}
                className="min-h-24"
              />
              <small>{bio.length.toLocaleString(locale)}/120</small>
            </label>
          </div>
          <div className="mt-6 flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="h-11 flex-1 rounded-full"
              disabled={!changed || saving}
              onClick={() => {
                setName(profile.name);
                setBio(profile.bio);
                setColor(profile.color);
              }}
            >
              {t('取消修改')}
            </Button>
            <Button
              className="h-11 flex-1 rounded-full"
              disabled={!changed || !name.trim() || saving}
            >
              <Save size={16} />
              {saving ? t('保存中…') : t('保存')}
            </Button>
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {user
              ? t('昵称与简介随账号保存，登录邮箱保持不变。')
              : t('这是当前浏览器的游客资料；登录不会覆盖这些资料。')}
          </p>
        </form>
      </main>
    </LibraryShell>
  );
}

export function SettingsPage() {
  const { t, locale } = useI18n();
  const isZh = locale.startsWith('zh');
  return (
    <LibraryShell hideNavigation>
      <main className="profile-page">
        <PageHeading title={t('设置')} back="/me" />
        <div className="settings-group">
          <SettingsRow
            icon={<ShieldCheck size={22} />}
            title={t('账号与安全')}
            href="/me/account"
          />
          <SettingsRow icon={<Globe2 size={22} />} title={t('界面语言')} href="/me/language" />
          <SettingsRow icon={<Palette size={22} />} title={t('阅读偏好')} href="/me/appearance" />
          <SettingsRow icon={<Sparkles size={22} />} title={t('AI 连接')} href="/me/models" />
          <SettingsRow icon={<HardDrive size={22} />} title={t('数据与备份')} href="/me/data" />
          <SettingsRow
            icon={<Activity size={22} />}
            title={t('诊断与隐私')}
            href="/me/diagnostics"
          />
        </div>
        <div className="settings-group">
          <SettingsRow
            icon={<ShieldCheck size={22} />}
            title={isZh ? '隐私政策' : 'Privacy Policy'}
            href="/privacy"
          />
          <SettingsRow
            icon={<BookOpen size={22} />}
            title={isZh ? '服务条款' : 'Terms of Service'}
            href="/terms"
          />
          <SettingsRow icon={<Info size={22} />} title={t('关于 ByPage · 逐页')} href="/me/about" />
        </div>
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
                <h2 className="font-semibold">
                  {isZh ? 'LeafRead 翻译与伴读' : 'LeafRead translation & companion'}
                </h2>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  {isZh
                    ? '登录即可使用平台提供的翻译服务，无需配置 API Key。'
                    : 'Sign in to use LeafRead translation. No API key required.'}
                </p>
                <p className="mt-3 text-sm">
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
                  <small>
                    {locale.startsWith('zh')
                      ? '用于尚未设置阅读语言的书籍。双语和仅译文会随阅读自动补齐，本书选择在阅读器中单独记住。'
                      : 'Used until a book has its own reading-language choice. Bilingual and translation-only modes translate as you read; the reader remembers each book’s choice.'}
                  </small>
                </div>
              </div>
            </>
          )}
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
        <div className="about-brand">
          <span className="brand-mark">
            <BookOpen size={32} />
          </span>
          <h1>{t('ByPage · 逐页')}</h1>
          <p>{t('跨越语言，读懂每一页。')}</p>
        </div>
        <div className="settings-form-card space-y-6 text-sm leading-8 text-muted-foreground">
          <p>
            {t(
              '一个以阅读为中心的多语言阅读器。导入自己的 EPUB 或 TXT，在原文、译文和笔记之间从容切换。',
            )}
          </p>
          <p>
            {t(
              '书籍、阅读位置和笔记保存在当前浏览器。AI 回答提供可核对的原文引用，帮助你提出问题、寻找线索，把判断留给自己。',
            )}
          </p>
          <p>{t('当前专注文字阅读，不支持 PDF、DRM 或扫描件。')}</p>
          <div className="space-y-3 border-t pt-5">
            <Link href="/me/data" className="flex items-center gap-2 text-primary">
              <Download size={16} />
              {t('备份我的阅读数据')}
            </Link>
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
        <p className="my-8 text-center text-xs text-muted-foreground">© 2026 LeafRead · v0.1.0</p>
      </main>
    </LibraryShell>
  );
}
