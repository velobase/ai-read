-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "translationPrompt" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "CatalogBook" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL DEFAULT 'Classics',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogEdition" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "chapterCount" INTEGER NOT NULL DEFAULT 0,
    "paragraphCount" INTEGER NOT NULL DEFAULT 0,
    "characterCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogAsset" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,

    CONSTRAINT "CatalogAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogImportJob" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogPublication" (
    "bookId" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogPublication_pkey" PRIMARY KEY ("bookId")
);

-- CreateTable
CREATE TABLE "CatalogCollection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogCollectionItem" (
    "collectionId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogCollectionItem_pkey" PRIMARY KEY ("collectionId","bookId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogBook_slug_key" ON "CatalogBook"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogAsset_key_key" ON "CatalogAsset"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogAsset_editionId_kind_key" ON "CatalogAsset"("editionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogImportJob_editionId_key" ON "CatalogImportJob"("editionId");

-- CreateIndex
CREATE INDEX "CatalogImportJob_state_leaseUntil_idx" ON "CatalogImportJob"("state", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogPublication_editionId_key" ON "CatalogPublication"("editionId");

-- AddForeignKey
ALTER TABLE "CatalogEdition" ADD CONSTRAINT "CatalogEdition_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "CatalogBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogAsset" ADD CONSTRAINT "CatalogAsset_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "CatalogEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogImportJob" ADD CONSTRAINT "CatalogImportJob_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "CatalogEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPublication" ADD CONSTRAINT "CatalogPublication_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "CatalogBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPublication" ADD CONSTRAINT "CatalogPublication_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "CatalogEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogCollectionItem" ADD CONSTRAINT "CatalogCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "CatalogCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogCollectionItem" ADD CONSTRAINT "CatalogCollectionItem_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "CatalogBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve personal translation preferences when switching to the platform service.
UPDATE "User" u SET "translationPrompt" = c."translationPrompt" FROM "AIConnection" c WHERE u.id = c."userId";
