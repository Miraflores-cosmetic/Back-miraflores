-- Referral touch outbox (retry after-commit) + DEBT ledger kind.

ALTER TYPE "ReferralLedgerKind" ADD VALUE IF NOT EXISTS 'DEBT';

CREATE TABLE "ReferralTouchOutbox" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralTouchOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralTouchOutbox_orderId_key" ON "ReferralTouchOutbox"("orderId");
CREATE INDEX "ReferralTouchOutbox_state_nextAttemptAt_idx" ON "ReferralTouchOutbox"("state", "nextAttemptAt");

ALTER TABLE "ReferralTouchOutbox" ADD CONSTRAINT "ReferralTouchOutbox_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
