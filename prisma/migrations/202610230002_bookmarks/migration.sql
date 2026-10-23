CREATE TABLE "Bookmark" (
  "userId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "body" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "mutationId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("userId", "bookId", "id"),
  CONSTRAINT "Bookmark_userId_bookId_fkey" FOREIGN KEY ("userId", "bookId") REFERENCES "Book"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
