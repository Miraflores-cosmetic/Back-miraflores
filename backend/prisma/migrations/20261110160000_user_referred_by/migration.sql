-- Sticky referral attribution across devices (TTL = linkTtlDays).

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "referredByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "referredByAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_referredByUserId_idx" ON "User"("referredByUserId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_referredByUserId_fkey"
  FOREIGN KEY ("referredByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
