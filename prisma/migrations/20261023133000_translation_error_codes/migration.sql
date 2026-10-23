-- Convert the two persisted translation failures observed at deployment to UI codes.
-- This changes only presentation metadata; source, checkpoints and translations stay intact.
UPDATE "TranslationEdition"
SET "error" = CASE "error"
  WHEN '原文已变化，请创建新译本。' THEN 'translation_source_changed'
  WHEN '模型没有返回正文。' THEN 'translation_empty_response'
END
WHERE "error" IN ('原文已变化，请创建新译本。', '模型没有返回正文。');

UPDATE "TranslationChapter"
SET "error" = CASE "error"
  WHEN '原文已变化，请创建新译本。' THEN 'translation_source_changed'
  WHEN '模型没有返回正文。' THEN 'translation_empty_response'
END
WHERE "error" IN ('原文已变化，请创建新译本。', '模型没有返回正文。');
