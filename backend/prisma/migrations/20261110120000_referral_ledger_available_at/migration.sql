-- Worker starvation fix: processDueQuarantine must not scan DELIVERED-mode PENDING.
-- availableAt = paidAt + qDays for DAYS_AFTER_PAID; null for DELIVERED (touch releases).

ALTER TABLE "ReferralWalletLedger" ADD COLUMN "availableAt" TIMESTAMP(3);

-- Explicit snapshot DAYS_AFTER_PAID
UPDATE "ReferralWalletLedger" AS l
SET "availableAt" = o."paidAt" + (
  (COALESCE(NULLIF(substring(l."note" from 'qDays=([0-9]+)'), '')::integer, 7))::text
  || ' days'
)::interval
FROM "Order" AS o
WHERE l."orderId" = o."id"
  AND l."status" = 'PENDING'
  AND l."kind" IN ('EARN', 'INVITEE_BONUS')
  AND o."paidAt" IS NOT NULL
  AND l."note" LIKE '%qMode=DAYS_AFTER_PAID%';

-- Legacy note without qMode: only if live settings are DAYS_AFTER_PAID
UPDATE "ReferralWalletLedger" AS l
SET "availableAt" = o."paidAt" + (
  (COALESCE(
    NULLIF(substring(l."note" from 'qDays=([0-9]+)'), '')::integer,
    (SELECT s."quarantineDays" FROM "ReferralSettings" s WHERE s."id" = 'default'),
    7
  ))::text || ' days'
)::interval
FROM "Order" AS o
WHERE l."orderId" = o."id"
  AND l."status" = 'PENDING'
  AND l."kind" IN ('EARN', 'INVITEE_BONUS')
  AND o."paidAt" IS NOT NULL
  AND l."availableAt" IS NULL
  AND l."note" IS NOT NULL
  AND l."note" NOT LIKE '%qMode=%'
  AND EXISTS (
    SELECT 1 FROM "ReferralSettings" s
    WHERE s."id" = 'default' AND s."quarantineMode" = 'DAYS_AFTER_PAID'
  );

CREATE INDEX "ReferralWalletLedger_status_availableAt_idx"
  ON "ReferralWalletLedger"("status", "availableAt");
