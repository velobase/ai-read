ALTER TABLE "Account" ADD COLUMN "encryptedNativeAppleRefreshToken" TEXT;
CREATE TABLE "NativeAuthUse" (
  "id" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NativeAuthUse_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NativeAuthUse_expires_idx" ON "NativeAuthUse"("expires");
