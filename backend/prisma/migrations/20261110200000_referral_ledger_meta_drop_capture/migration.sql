-- 1) Структурированные meta вместо regex по note.
ALTER TABLE "ReferralWalletLedger"
  ADD COLUMN "qMode" "ReferralQuarantineMode",
  ADD COLUMN "qDays" INTEGER,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "earnBase" INTEGER,
  ADD COLUMN "earnPct" INTEGER;

CREATE INDEX "ReferralWalletLedger_source_idx" ON "ReferralWalletLedger"("source");
CREATE INDEX "ReferralWalletLedger_kind_source_idx" ON "ReferralWalletLedger"("kind", "source");

-- Backfill quarantine snapshot из note (EARN / INVITEE_BONUS).
UPDATE "ReferralWalletLedger"
SET
  "qMode" = CASE
    WHEN note ~ 'qMode=DELIVERED_PLUS_DAYS' THEN 'DELIVERED_PLUS_DAYS'::"ReferralQuarantineMode"
    WHEN note ~ 'qMode=DAYS_AFTER_PAID' THEN 'DAYS_AFTER_PAID'::"ReferralQuarantineMode"
    WHEN note ~ 'qMode=DELIVERED' THEN 'DELIVERED'::"ReferralQuarantineMode"
    ELSE NULL
  END,
  "qDays" = CASE
    WHEN note ~ 'qDays=([0-9]+)' THEN (substring(note from 'qDays=([0-9]+)'))::int
    ELSE NULL
  END,
  "earnBase" = CASE
    WHEN note ~ 'base=([0-9]+)' THEN (substring(note from 'base=([0-9]+)'))::int
    ELSE NULL
  END,
  "earnPct" = CASE
    WHEN note ~ 'pct=([0-9]+)' THEN (substring(note from 'pct=([0-9]+)'))::int
    ELSE NULL
  END
WHERE kind IN ('EARN', 'INVITEE_BONUS');

-- Backfill source для CLAWBACK / DEBT.
UPDATE "ReferralWalletLedger"
SET "source" = 'invitee'
WHERE kind IN ('CLAWBACK', 'DEBT')
  AND (
    note LIKE 'clawback invitee%'
    OR note LIKE 'debt invitee%'
  );

UPDATE "ReferralWalletLedger"
SET "source" = 'debt'
WHERE kind = 'CLAWBACK'
  AND note LIKE 'clawback debt%';

UPDATE "ReferralWalletLedger"
SET "source" = 'earn'
WHERE kind IN ('CLAWBACK', 'DEBT')
  AND "source" IS NULL
  AND (
    note LIKE 'clawback earn%'
    OR note LIKE 'debt earn%'
    OR note IS NULL
    OR note = ''
  );

-- 2) Удаление мёртвого SPEND_CAPTURE из enum (PG: recreate type).
-- Partial indexes with WHERE kind = … break ALTER … TYPE (operator does not exist).
DELETE FROM "ReferralWalletLedger" WHERE kind = 'SPEND_CAPTURE';

DROP INDEX IF EXISTS "ReferralWalletLedger_earn_orderId_key";
DROP INDEX IF EXISTS "ReferralWalletLedger_invitee_bonus_userId_key";

CREATE TYPE "ReferralLedgerKind_new" AS ENUM (
  'EARN',
  'SPEND_HOLD',
  'SPEND_RELEASE',
  'CLAWBACK',
  'ADJUST',
  'INVITEE_BONUS',
  'DEBT'
);

ALTER TABLE "ReferralWalletLedger"
  ALTER COLUMN "kind" TYPE "ReferralLedgerKind_new"
  USING ("kind"::text::"ReferralLedgerKind_new");

DROP TYPE "ReferralLedgerKind";
ALTER TYPE "ReferralLedgerKind_new" RENAME TO "ReferralLedgerKind";

CREATE UNIQUE INDEX "ReferralWalletLedger_earn_orderId_key"
  ON "ReferralWalletLedger"("orderId")
  WHERE kind = 'EARN' AND "orderId" IS NOT NULL;

CREATE UNIQUE INDEX "ReferralWalletLedger_invitee_bonus_userId_key"
  ON "ReferralWalletLedger"("userId")
  WHERE kind = 'INVITEE_BONUS' AND status IN ('PENDING', 'POSTED');
