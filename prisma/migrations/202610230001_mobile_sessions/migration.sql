ALTER TABLE "Session" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'web';
ALTER TABLE "Session" ADD COLUMN "origin" TEXT;

CREATE TABLE "MobileAuthorization" (
  "codeHash" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "webSessionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MobileAuthorization_pkey" PRIMARY KEY ("codeHash"),
  CONSTRAINT "MobileAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MobileAuthorization_webSessionId_fkey" FOREIGN KEY ("webSessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MobileAuthorization_expires_idx" ON "MobileAuthorization"("expires");
CREATE INDEX "MobileAuthorization_userId_idx" ON "MobileAuthorization"("userId");
CREATE INDEX "MobileAuthorization_webSessionId_idx" ON "MobileAuthorization"("webSessionId");
