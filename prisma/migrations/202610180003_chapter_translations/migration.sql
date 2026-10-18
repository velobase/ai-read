CREATE TABLE "TranslationEdition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "targetLanguage" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "profile" JSONB NOT NULL,
  "glossary" JSONB NOT NULL DEFAULT '[]',
  "state" TEXT NOT NULL DEFAULT 'idle',
  "error" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TranslationEdition_userId_bookId_fkey" FOREIGN KEY ("userId", "bookId")
    REFERENCES "Book"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TranslationEdition_userId_bookId_targetLanguage_createdAt_idx"
  ON "TranslationEdition"("userId", "bookId", "targetLanguage", "createdAt");
CREATE INDEX "TranslationEdition_state_leaseUntil_idx" ON "TranslationEdition"("state", "leaseUntil");
CREATE TABLE "TranslationChapter" (
  "editionId" TEXT NOT NULL,
  "chapterIndex" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'missing',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "totalChunks" INTEGER NOT NULL,
  "completedChunks" INTEGER NOT NULL DEFAULT 0,
  "checkpoint" JSONB NOT NULL DEFAULT '[]',
  "paragraphs" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "retryAt" TIMESTAMP(3),
  "error" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("editionId", "chapterIndex"),
  CONSTRAINT "TranslationChapter_editionId_fkey" FOREIGN KEY ("editionId")
    REFERENCES "TranslationEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TranslationChapter_editionId_state_priority_idx"
  ON "TranslationChapter"("editionId", "state", "priority");
CREATE TABLE "TranslationSelection" (
  "userId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "targetLanguage" TEXT NOT NULL,
  "editionId" TEXT NOT NULL,
  PRIMARY KEY ("userId", "bookId", "targetLanguage"),
  CONSTRAINT "TranslationSelection_userId_bookId_fkey" FOREIGN KEY ("userId", "bookId")
    REFERENCES "Book"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TranslationSelection_editionId_fkey" FOREIGN KEY ("editionId")
    REFERENCES "TranslationEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
