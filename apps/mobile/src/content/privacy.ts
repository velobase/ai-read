export const privacyUrl = 'https://leafread.ai/bypage/privacy.html';
export const supportUrl = 'https://leafread.ai/bypage/support.html';
export const supportEmail = 'leafread-support@googlegroups.com';
export const privacyUpdated = '2026-10-23';

export const privacyContent = {
  'zh-CN': [
    [
      '适用范围',
      '本政策适用于 UTOPIX, LLC 发布的 叶子阅读 iOS 阅读应用。基础阅读无需账号。App 使用 leafread.ai 官方服务提供账号、在线 AI 与可选书库同步，不支持自定义服务器。登录不会自动上传本机书籍或笔记，诊断也不会自动上传。',
    ],
    [
      '本机阅读数据',
      '你通过系统文件选择器或“在 叶子阅读 中打开”选择的 EPUB、PDF、TXT 和阅读包在设备上解析。正文、插图、阅读进度、书签、笔记、保存的译文与对话存储在应用的本机数据库中。PDF 原页副本保存在应用私有目录，并排除在设备备份之外。其他本机数据可能随你的 iOS 设备备份设置备份。PDF 文字识别在设备上完成；朗读使用系统语音能力。',
    ],
    [
      '官方账号与在线服务',
      'App 连接 leafread.ai 官方服务以检查功能可用性和登录状态，该服务会接收连接请求及通常的网络信息，例如 IP 地址。你可选择 Apple 或 Google 登录。Apple 提供姓名和邮箱（可选择隐藏邮箱）；Google 提供姓名、邮箱及头像。我们不会获取你的 Apple 或 Google 密码。为在注销时撤销 Apple 授权，服务器加密保存 Apple 刷新令牌，仅用于身份授权管理。登录后，服务可向 App 提供姓名、邮箱、用户标识及会话信息；登录凭据保存在 iOS Keychain 中。只有在你主动发起在线 AI 操作时，必要的书籍信息、原文片段、问题和相关对话上下文才会发送给官方服务及其配置的模型提供方。手机书库不会因此自动同步到云端。你可以不登录而继续本机阅读。',
    ],
    [
      '可选的账号书库',
      '如果你单独开启书库同步并进入账号书库，该书库中的书籍正文和支持的插图、阅读进度、笔记与书签会与官方服务同步，并可能在后台切换回前台或本机内容变更后继续同步。账号书库与本机书库分开保存；只有你明确选择复制的本机书籍才会进入账号书库。保存的译文、AI 对话历史、阅读设置以及保留的 PDF 原文件不通过书库同步上传。返回本机书库会停止当前账号书库的自动同步，但不会删除服务端已有副本；删除服务端数据请使用账号管理或删除功能。',
    ],
    [
      '诊断、分享与客服',
      'App 的操作类别、耗时、结果等诊断保存在本机，不含书籍正文、笔记、搜索词或密钥，不会自动上传。导出阅读包、笔记或诊断会打开系统分享面板，只有你选定的接收方获得文件。联系客服时，你主动发送的邮箱、消息和附件将用于处理请求；不要发送密码或 API Key。客服信息保留至处理所需期间，之后可联系支持邮箱请求删除。',
    ],
    [
      '保留、删除和撤回',
      '你可以在书籍菜单移除本机书籍及关联内容，删除单条笔记，或导出阅读包进行备份。退出已连接的账号会移除本机凭据并尝试撤销服务端会话；请在卸载前退出账号，Keychain 凭据可能不会随卸载清除。通过 iOS“删除 App”可移除应用沙盒中的本机数据；你自行保存或分享的备份需另行删除。在 App 的“我 → 账号管理 → 注销账号”可永久删除云端资料、书库、笔记、书签、译文、对话及 AI 配置，并撤销所有登录及 Apple 授权。本设备的账号书库缓存也会清除；本机书库和单独导出的备份保留。其他设备的离线缓存需要在对应设备清除；模型提供方依法或依其服务政策留存的请求记录可联系支持协助处理。',
    ],
    [
      '隐私承诺与联系',
      '叶子阅读 iOS 不包含广告，不进行跨应用跟踪，不出售阅读数据，也不自动启用第三方分析或会话录屏。我们不要求通讯录、定位、相册或麦克风权限来阅读。政策更新会在此页面显示日期。隐私问题与删除请求请联系 leafread-support@googlegroups.com。',
    ],
  ],
  en: [
    [
      'Scope',
      'This policy covers the LeafRead iOS reader published by UTOPIX, LLC. Basic reading requires no account. The app uses the official leafread.ai service for accounts, online AI and optional library sync. Custom servers are not supported. Signing in does not automatically upload device books or notes, and diagnostics are not uploaded automatically.',
    ],
    [
      'Reading data on your device',
      'EPUB, PDF, TXT and reading packs you select through the system document picker or Open in LeafRead are parsed on your device. Text, illustrations, positions, bookmarks, notes, saved translations and conversations are stored in the app’s local database. Retained original PDFs are stored in the private app directory and excluded from device backups. Other local data may be backed up according to your iOS settings. PDF text recognition runs on-device; read aloud uses system speech capabilities.',
    ],
    [
      'Official account and online services',
      'The app connects to the official leafread.ai service to check feature availability and sign-in status. The service receives connection requests and ordinary network information such as your IP address. You can choose Apple or Google sign-in. Apple provides your name and email, with Hide My Email available; Google provides your name, email and profile image. We never receive your Apple or Google password. The server encrypts and stores Apple refresh tokens solely for identity authorization management, including revocation when you delete your account. After sign-in, it may provide the app with your name, email, user identifier and session information; authentication credentials are stored in iOS Keychain. Only when you initiate online AI actions are necessary book details, source passages, questions and relevant conversation context sent to the official service and its configured model provider. Connecting does not automatically upload or synchronize your phone library. You can continue local reading without signing in.',
    ],
    [
      'Optional account library',
      'If you enable library synchronization and open your account library, its book text and supported illustrations, reading positions, notes and bookmarks are synchronized with the official service. Synchronization may continue when you return to the foreground or edit library content. Account and device libraries are stored separately; device books enter the account library only when you explicitly copy them. Saved translations, AI conversation history, reading preferences and retained original PDF files are not uploaded through library synchronization. Returning to the device library stops automatic synchronization of the current account library without deleting existing server copies. Use account-management or deletion features to remove server data.',
    ],
    [
      'Diagnostics, sharing and support',
      'Operation categories, timings and results stay on-device. Diagnostics exclude book text, notes, searches and keys and are never uploaded automatically. Exporting reading packs, notes or diagnostics opens the system share sheet; only recipients you choose receive the files. If you contact support, the email address, messages and attachments you send are used to handle your request. Do not send passwords or API keys. Support correspondence is retained as needed to resolve your request; contact support to request deletion.',
    ],
    [
      'Retention, deletion and withdrawal',
      'Use a book’s menu to remove its local data and associated content, delete individual notes, or export a reading pack for backup. Signing out removes local credentials and attempts to revoke the server session. Sign out before uninstalling: Keychain credentials may survive app removal. Delete App in iOS removes the local app sandbox; separately delete backups you saved or shared. Use Me → Account → Delete account in the app to permanently delete your cloud profile, library, notes, bookmarks, translations, conversations and AI settings, and revoke all sessions and Apple authorization. The account library cache on this device is also cleared; device-library books and separately exported backups remain. Offline caches on other devices must be cleared on those devices. Contact support for assistance with request records retained by model providers under their policies or legal obligations.',
    ],
    [
      'Privacy choices and contact',
      'LeafRead iOS has no advertising, cross-app tracking, sale of reading data, automatic third-party analytics or session replay. Reading does not require Contacts, Location, Photos or Microphone permission. Policy updates are dated on this page. For privacy questions and deletion requests, contact leafread-support@googlegroups.com.',
    ],
  ],
} as const;
