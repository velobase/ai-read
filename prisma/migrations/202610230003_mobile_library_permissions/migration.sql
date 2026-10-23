-- Existing sessions and in-flight authorization grants remain AI-only.
-- A library grant is created only by the separate, explicit browser consent flow.
ALTER TABLE "Session"
  ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY['account_ai']::TEXT[];
ALTER TABLE "MobileAuthorization"
  ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY['account_ai']::TEXT[];

ALTER TABLE "Session" ADD CONSTRAINT "Session_permissions_check"
  CHECK ("permissions" = ARRAY['account_ai']::TEXT[]
    OR "permissions" = ARRAY['account_ai', 'library_sync']::TEXT[]);
ALTER TABLE "MobileAuthorization" ADD CONSTRAINT "MobileAuthorization_permissions_check"
  CHECK ("permissions" = ARRAY['account_ai']::TEXT[]
    OR "permissions" = ARRAY['account_ai', 'library_sync']::TEXT[]);
