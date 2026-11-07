-- Order.paidAt — карантин DAYS_AFTER_PAID от первой оплаты, не от earn.createdAt
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_paidAt_idx" ON "Order"("paidAt");

-- Backfill: первый PAID / MARK_PAID event
UPDATE "Order" o
SET "paidAt" = e."createdAt"
FROM (
  SELECT DISTINCT ON ("orderId") "orderId", "createdAt"
  FROM "OrderEvent"
  WHERE type IN ('PAID', 'MARK_PAID')
  ORDER BY "orderId", "createdAt" ASC
) e
WHERE o.id = e."orderId"
  AND o."paidAt" IS NULL;

-- Fallback: уже paid-like без event
UPDATE "Order"
SET "paidAt" = "updatedAt"
WHERE "paidAt" IS NULL
  AND status IN ('PAID', 'PACKING', 'SHIPPED', 'DELIVERED', 'REFUNDED');

-- ReferralSettings.enabledAt — earn только для attribution ≥ момента включения
ALTER TABLE "ReferralSettings" ADD COLUMN IF NOT EXISTS "enabledAt" TIMESTAMP(3);

-- FK ledger → order (для join quarantine по paidAt)
ALTER TABLE "ReferralWalletLedger"
  ADD CONSTRAINT "ReferralWalletLedger_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique: один EARN на orderId (защита от смены формата idempotencyKey)
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralWalletLedger_earn_orderId_key"
  ON "ReferralWalletLedger"("orderId")
  WHERE kind = 'EARN' AND "orderId" IS NOT NULL;
