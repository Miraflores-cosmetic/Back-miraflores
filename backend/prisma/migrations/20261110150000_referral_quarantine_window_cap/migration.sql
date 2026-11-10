-- DELIVERED_PLUS_DAYS quarantine; safer earn defaults; window + monthly cap; address-match flag.

ALTER TYPE "ReferralQuarantineMode" ADD VALUE IF NOT EXISTS 'DELIVERED_PLUS_DAYS';

ALTER TABLE "ReferralSettings"
  ADD COLUMN IF NOT EXISTS "earnWindowMaxOrders" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "earnWindowDays" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "monthlyEarnCapRub" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ReferralSettings"
  ALTER COLUMN "earnMode" SET DEFAULT 'FIRST_GOODS_ORDER';

-- Singleton ещё на factory EVERY → safer default (ручной EVERY в админке не трогаем, если уже меняли %).
UPDATE "ReferralSettings"
SET "earnMode" = 'FIRST_GOODS_ORDER'
WHERE "id" = 'default'
  AND "earnMode" = 'EVERY'
  AND "earnPercent" = 5
  AND "enabled" = false;

ALTER TABLE "OrderReferralAttribution"
  ADD COLUMN IF NOT EXISTS "addressMatchSuspect" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "addressMatchReason" TEXT;

CREATE INDEX IF NOT EXISTS "OrderReferralAttribution_addressMatchSuspect_idx"
  ON "OrderReferralAttribution"("addressMatchSuspect");
