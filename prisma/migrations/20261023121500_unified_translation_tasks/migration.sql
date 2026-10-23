-- Preserve every existing edition and checkpoint while decoupling translation from library sync.
ALTER TABLE "TranslationEdition" ADD COLUMN "source" JSONB;
UPDATE "TranslationEdition" e SET "source" = b."content" - 'media' - 'cover' - 'references' - 'toc'
FROM "Book" b WHERE b."userId" = e."userId" AND b."id" = e."bookId";
ALTER TABLE "TranslationEdition" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE "TranslationEdition" DROP CONSTRAINT "TranslationEdition_userId_bookId_fkey";
ALTER TABLE "TranslationSelection" DROP CONSTRAINT "TranslationSelection_userId_bookId_fkey";
ALTER TABLE "TranslationEdition" ADD CONSTRAINT "TranslationEdition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TranslationSelection" ADD CONSTRAINT "TranslationSelection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
