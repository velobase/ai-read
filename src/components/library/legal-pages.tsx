'use client';

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact';

import Link from 'next/link';
import { BookOpen, Mail, Globe2, ShieldCheck, FileText } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { LibraryShell, PageHeading } from './library-ui';

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { t, locale } = useI18n();
  const isZh = locale.startsWith('zh');
  const isPrivacy = kind === 'privacy';

  return (
    <LibraryShell hideNavigation>
      <main className="profile-page">
        <PageHeading
          title={
            isPrivacy
              ? isZh
                ? '隐私政策'
                : 'Privacy Policy'
              : isZh
                ? '服务条款'
                : 'Terms of Service'
          }
          back="/me"
        />

        <div className="mb-5 flex gap-2 rounded-full bg-white p-1.5 text-sm">
          <Link
            href="/privacy"
            className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-center transition-colors ${
              isPrivacy ? 'bg-primary text-white font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ShieldCheck size={16} />
            {isZh ? '隐私政策' : 'Privacy Policy'}
          </Link>
          <Link
            href="/terms"
            className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-center transition-colors ${
              !isPrivacy ? 'bg-primary text-white font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText size={16} />
            {isZh ? '服务条款' : 'Terms of Service'}
          </Link>
        </div>

        <div className="settings-form-card space-y-6 text-sm leading-8 text-muted-foreground">
          {isPrivacy ? (
            isZh ? (
              <>
                <div>
                  <h2 className="mb-2 text-base font-semibold text-foreground">1. 本地优先的数据存储</h2>
                  <p>
                    {t('ByPage · 逐页')} 采用本地优先（Local-First）架构。你导入的无 DRM EPUB 与 UTF-8 TXT 书籍在浏览器本地完成解析，原始电子书文件不会上传至服务器。提取的正文、阅读位置、划线、想法笔记、自动译文与对话记录默认保存在当前浏览器的 IndexedDB 与 localStorage 中。
                  </p>
                </div>
                <div>
                  <h2 className="mb-2 text-base font-semibold text-foreground">2. 账号登录与云端同步</h2>
                  <p>
                    你可以始终以游客身份在本地阅读。当你选择使用 Google 账号登录时，我们仅读取你的基本公开资料（昵称、头像与验证邮箱）以创建阅读身份。登录后，已解析的书籍文本、封面、书架状态、阅读进度、笔记、已完成对话与译文缓存会在你的设备与所部署的 PostgreSQL 数据库之间同步。游客书库保持独立，除非你主动选择导入。
                  </p>
                </div>
                <div>
                  <h2 className="mb-2 text-base font-semibold text-foreground">3. AI 模型服务与密钥安全</h2>
                  <p>
                    登录后，你可以直接使用 LeafRead 提供的翻译与伴读服务，无需填写 API Key。使用这些功能时，选中的段落、参考原文、书名、问题与近期对话会通过 LeafRead 服务器发送到 OpenRouter 及所选模型提供商处理，适用其隐私政策。平台 Key 仅保存在服务器 Secret 中，不发送到手机或浏览器。完整异常及上游错误响应保存在受访问控制保护的服务端日志中，用于排障；错误响应可能包含相关请求内容。
                  </p>
                </div>
                <div>
                  <h2 className="mb-2 text-base font-semibold text-foreground">4. 无追踪与数据自主权</h2>
                  <p>
                    本应用不内置第三方广告或行为分析追踪器。你可以随时在“我 → 数据与备份”中导出完整阅读备份（JSON）或将笔记导出为 Markdown，也可随时清除浏览器本地存储或退出登录设备。
                  </p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <h2 className="mb-2 text-base font-semibold text-foreground">
                    1. Local-First Data Storage
                  </h2>
                  <p>
                    {t('ByPage · 逐页')} is built on a local-first architecture. DRM-free EPUB and UTF-8 TXT files you import are parsed directly in your browser; raw ebook files are not uploaded to our servers. Extracted text, reading positions, highlights, notes, translations, and conversations are stored locally in your browser’s IndexedDB and localStorage by default.
                  </p>
                </div>
                <div>
                  <h2 className="mb-2 text-base font-semibold text-foreground">
                    2. Accounts & Cloud Synchronization
                  </h2>
                  <p>
                    You may read locally as a guest at any time. If you sign in with Google, we only use your basic profile information (name, avatar photo, and verified email address) to maintain your reader identity and sessions. For signed-in accounts, parsed book text, covers, shelf state, reading positions, notes, completed AI turns, and translations synchronize across your devices. Your guest library remains separate unless you explicitly import it.
                  </p>
                </div>
                <div>
                  <h2 className="mb-2 text-base font-semibold text-foreground">
                    3. AI Providers & API Key Security
                  </h2>
                  <p>
                    Signed-in readers can use LeafRead translation and reading assistance without supplying an API key. When you use these features, selected passages, reference text, book titles, questions and recent conversations are sent through LeafRead servers to OpenRouter and the selected model provider. Their privacy policies apply. Platform credentials remain in server Secrets and are never sent to your device. Complete exceptions and upstream error responses are retained in access-controlled server logs for troubleshooting; error responses may include related request content.
                  </p>
                </div>
                <div>
                  <h2 className="mb-2 text-base font-semibold text-foreground">
                    4. No Tracking & Data Portability
                  </h2>
                  <p>
                    LeafRead does not bundle third-party advertising or analytics trackers. You can export your books, notes, and reading progress at any time under Me → Data & backups, export notes as Markdown, or revoke active device sessions under Account & security.
                  </p>
                </div>
              </>
            )
          ) : isZh ? (
            <>
              <div>
                <h2 className="mb-2 text-base font-semibold text-foreground">1. 服务说明与合理使用</h2>
                <p>
                  欢迎使用 {t('ByPage · 逐页')}（官方网站：leafread.ai）。本服务为你提供多语言电子书阅读、双语对照及基于原文引用的 AI 伴读工具。请仅导入你拥有合法阅读权限且无数字版权管理（DRM）限制的 EPUB 或 UTF-8 TXT 文件，切勿利用本工具规避版权保护或进行非法传播。
                </p>
              </div>
              <div>
                <h2 className="mb-2 text-base font-semibold text-foreground">2. 用户内容与知识产权</h2>
                <p>
                  你导入的书籍、撰写的划线与想法笔记均归你本人或原著作权人所有。书城内置的原创短文与示例内容采用 MIT 许可证提供。LeafRead 品牌、界面设计与软件源代码受相关著作权与开源许可保护（© 2026 LeafRead）。
                </p>
              </div>
              <div>
                <h2 className="mb-2 text-base font-semibold text-foreground">3. AI 生成内容免责声明</h2>
                <p>
                  自动译文与 AI 伴读回答由所连接的语言模型实时生成，仅供阅读参考。即便回答中包含可点击的段落引用编号，也不代表所引原文必然能够推导出模型的结论。请始终以书籍原文为准，自行核对与判断。
                </p>
              </div>
              <div>
                <h2 className="mb-2 text-base font-semibold text-foreground">4. 数据备份与服务变更</h2>
                <p>
                  鉴于浏览器本地存储可能因清理缓存或更换设备而丢失，请妥善保留原始电子书文件并定期使用“数据与备份”功能导出备份。在法律允许的范围内，本服务按“现状（AS IS）”提供，不对因第三方模型服务中断、网络故障或未备份本地数据造成的内容损失承担责任。
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <h2 className="mb-2 text-base font-semibold text-foreground">
                  1. Service Overview & Acceptable Use
                </h2>
                <p>
                  Welcome to {t('ByPage · 逐页')} (official website: leafread.ai). LeafRead provides multilingual ebook reading, bilingual comparison, and source-grounded AI reading companionship. You agree to import only DRM-free EPUB or UTF-8 TXT files that you have the legal right to read, and not to use the service to bypass technological protection measures or infringe copyright.
                </p>
              </div>
              <div>
                <h2 className="mb-2 text-base font-semibold text-foreground">
                  2. Your Content & Intellectual Property
                </h2>
                <p>
                  Books you import and notes or highlights you create remain yours or their respective copyright holders’. Built-in sample essays are original works provided under the MIT License. The LeafRead name, interface design, and software are protected by copyright and applicable open-source licenses (© 2026 LeafRead).
                </p>
              </div>
              <div>
                <h2 className="mb-2 text-base font-semibold text-foreground">
                  3. AI-Generated Content Disclaimer
                </h2>
                <p>
                  Translations and AI companion responses are generated by language models and may contain inaccuracies or omissions. The presence of a clickable passage citation verifies only that the passage exists in the book, not that it entails the model’s claim. Always verify important information against the original text.
                </p>
              </div>
              <div>
                <h2 className="mb-2 text-base font-semibold text-foreground">
                  4. Backups & Limitation of Liability
                </h2>
                <p>
                  Because browser storage can be cleared by device or browser actions, please keep your original ebook files and regularly export backups from Me → Data & backups. To the maximum extent permitted by law, LeafRead is provided “AS IS” without warranties of any kind.
                </p>
              </div>
            </>
          )}

          <div className="space-y-3 border-t pt-5 text-xs">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <a
                href="https://leafread.ai"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-primary hover:underline"
              >
                <Globe2 size={14} />
                leafread.ai
              </a>
              <a
                href={SUPPORT_MAILTO}
                className="inline-flex items-center gap-1.5 text-primary hover:underline"
              >
                <Mail size={14} />
                {SUPPORT_EMAIL}
              </a>
              <Link href="/me/about" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                <BookOpen size={14} />
                {t('关于 ByPage · 逐页')}
              </Link>
            </div>
            <p className="text-muted-foreground/80">
              © 2026 LeafRead. All rights reserved.
            </p>
          </div>
        </div>
      </main>
    </LibraryShell>
  );
}
