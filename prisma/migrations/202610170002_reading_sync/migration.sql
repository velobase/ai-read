-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferences" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "preferencesMutation" TEXT,
ADD COLUMN     "preferencesVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Book" (
    "userId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "shelfState" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "mutationId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Book_pkey" PRIMARY KEY ("userId","id")
);

-- CreateTable
CREATE TABLE "ReadingProgress" (
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "position" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mutationId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReadingProgress_pkey" PRIMARY KEY ("userId","bookId")
);

-- CreateTable
CREATE TABLE "Note" (
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "paragraphId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mutationId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Note_pkey" PRIMARY KEY ("userId","bookId","id")
);

-- CreateTable
CREATE TABLE "ChatTurn" (
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mutationId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChatTurn_pkey" PRIMARY KEY ("userId","bookId","id")
);

-- CreateTable
CREATE TABLE "TranslationCache" (
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "paragraphId" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mutationId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TranslationCache_pkey" PRIMARY KEY ("userId","bookId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Book_userId_sourceHash_key" ON "Book"("userId", "sourceHash");

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingProgress" ADD CONSTRAINT "ReadingProgress_userId_bookId_fkey" FOREIGN KEY ("userId", "bookId") REFERENCES "Book"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_bookId_fkey" FOREIGN KEY ("userId", "bookId") REFERENCES "Book"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatTurn" ADD CONSTRAINT "ChatTurn_userId_bookId_fkey" FOREIGN KEY ("userId", "bookId") REFERENCES "Book"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationCache" ADD CONSTRAINT "TranslationCache_userId_bookId_fkey" FOREIGN KEY ("userId", "bookId") REFERENCES "Book"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
