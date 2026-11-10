-- Сумма уже RELEASE-нутого wallet при partial/full refund.
-- commission-base: remaining + released = исходный credit (не раздувает earn base).
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "referralWalletReleasedAmount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: Σ SPEND_RELEASE по заказу (amount RELEASE > 0).
UPDATE "Order" o
SET "referralWalletReleasedAmount" = sub.released
FROM (
  SELECT
    l."orderId" AS oid,
    COALESCE(SUM(l.amount), 0)::int AS released
  FROM "ReferralWalletLedger" l
  WHERE l.kind = 'SPEND_RELEASE'
    AND l.status = 'POSTED'
    AND l."orderId" IS NOT NULL
  GROUP BY l."orderId"
) sub
WHERE o.id = sub.oid
  AND sub.released > 0;
