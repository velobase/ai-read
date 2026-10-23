const messages = {
  translation_source_changed: {
    en: 'This edition does not match the current source. Create a new edition; saved translations are retained.',
    zh: '此译本与当前原文不一致，请创建新译本。已保存的译文仍然保留。',
  },
  translation_provider_changed: {
    en: 'The translation service configuration has changed. Create a new edition to continue.',
    zh: '翻译服务配置已变化，请创建新译本后继续。',
  },
  translation_checkpoint_mismatch: {
    en: 'The saved translation checkpoint does not match this task. Create a new edition to continue.',
    zh: '已保存的翻译断点与任务不一致，请创建新译本后继续。',
  },
  translation_connection_interrupted: {
    en: 'The translation connection was interrupted. Completed work is saved; retry to continue.',
    zh: '翻译连接已中断，完成的内容已保存，请重试继续。',
  },
  translation_authentication_failed: {
    en: 'The translation service could not authenticate. Please try again later.',
    zh: '翻译服务暂时无法认证，请稍后重试。',
  },
  translation_balance_insufficient: {
    en: 'LeafRead’s translation service is temporarily unavailable. Please try again later.',
    zh: 'LeafRead 的翻译服务暂时不可用，请稍后重试。',
  },
  translation_forbidden: {
    en: 'The translation service declined this request. Please try again later.',
    zh: '翻译服务暂时拒绝了请求，请稍后重试。',
  },
  translation_model_unavailable: {
    en: 'The translation model is temporarily unavailable. Please try again later.',
    zh: '翻译模型暂时不可用，请稍后重试。',
  },
  translation_rate_limited: {
    en: 'The translation service is busy. Please wait a moment before retrying.',
    zh: '翻译服务请求较多，请稍等片刻后重试。',
  },
  translation_service_unavailable: {
    en: 'The translation service is temporarily unavailable. Please try again later.',
    zh: '翻译服务暂时不可用，请稍后重试。',
  },
  translation_empty_response: {
    en: 'The translation service returned no text. Please retry.',
    zh: '翻译服务没有返回正文，请重试。',
  },
  translation_response_too_large: {
    en: 'The translation response was too large to save. This chapter has not been published.',
    zh: '译文响应过长，无法保存，本章尚未发布。',
  },
  translation_incomplete_response: {
    en: 'The translation response was incomplete. Retry to finish this chapter.',
    zh: '翻译服务未完整返回译文，请重试完成本章。',
  },
  translation_invalid_response: {
    en: 'The translation response could not be read. Please retry.',
    zh: '无法读取翻译服务返回的译文，请重试。',
  },
  translation_request_invalid: {
    en: 'This translation request is invalid. Reopen the book and try again.',
    zh: '翻译请求无效，请重新打开书籍后重试。',
  },
  translation_edition_not_found: {
    en: 'This translation edition could not be found. Refresh the available editions.',
    zh: '没有找到这个译本，请刷新译本列表。',
  },
  translation_chapter_not_ready: {
    en: 'This chapter’s translation is not ready yet. Check its progress shortly.',
    zh: '本章译文尚未准备完成，请稍后查看进度。',
  },
  translation_load_failed: {
    en: 'The translation could not be loaded. Please retry.',
    zh: '译文暂时无法读取，请重试。',
  },
  translation_storage_failed: {
    en: 'The translation could not be saved on this device. Check the available storage and retry.',
    zh: '译文无法保存到本机，请检查可用存储空间后重试。',
  },
  translation_browser_unsupported: {
    en: 'This browser cannot run persistent translation tasks. Please use an up-to-date browser.',
    zh: '当前浏览器不支持持久翻译任务，请使用新版浏览器。',
  },
  translation_book_not_found: {
    en: 'This book could not be found. Return to your library and reopen it.',
    zh: '没有找到这本书，请返回书库后重新打开。',
  },
  translation_platform_unavailable: {
    en: 'LeafRead’s translation service is temporarily unavailable. Please try again later.',
    zh: 'LeafRead 的翻译服务暂时不可用，请稍后重试。',
  },
  translation_edition_not_complete: {
    en: 'Switch to this edition when it is complete. Your current edition remains available.',
    zh: '新译本完成后即可切换，当前译本仍可阅读。',
  },
  native_session_required: {
    en: 'Please sign in to translate.',
    zh: '请先登录，再开始翻译。',
  },
  translationLoadError: {
    en: 'Saved translations could not be loaded. Please retry.',
    zh: '已保存的译文暂时无法读取，请重试。',
  },
  translation_failed: {
    en: 'The translation task could not be processed. Please try again later.',
    zh: '暂时无法处理翻译任务，请稍后重试。',
  },
} as const;

/** Diagnostic details stay in logs; clients display only localized, known error codes. */
export function translationErrorMessage(code: string, locale: string): string {
  const message = Object.hasOwn(messages, code)
    ? messages[code as keyof typeof messages]
    : messages.translation_failed;
  return locale.toLowerCase().startsWith('zh') ? message.zh : message.en;
}
