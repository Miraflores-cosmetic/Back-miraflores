-- Miraflores internal referral wallet (Phase 1): settings + attribution + ledger schema.
-- Earn/spend logic — later phases; YouRich OrderAffiliateLead не трогаем.

CREATE TYPE "ReferralEarnMode" AS ENUM ('EVERY', 'FIRST_GOODS_ORDER');
CREATE TYPE "ReferralQuarantineMode" AS ENUM ('DELIVERED', 'DAYS_AFTER_PAID');
CREATE TYPE "ReferralLedgerKind" AS ENUM (
  'EARN',
  'SPEND_HOLD',
  'SPEND_CAPTURE',
  'SPEND_RELEASE',
  'CLAWBACK',
  'ADJUST',
  'INVITEE_BONUS'
);
CREATE TYPE "ReferralLedgerStatus" AS ENUM ('PENDING', 'POSTED', 'VOIDED');

ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN "referralCodeActive" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

CREATE TABLE "ReferralSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "earnPercent" INTEGER NOT NULL DEFAULT 5,
    "earnMode" "ReferralEarnMode" NOT NULL DEFAULT 'EVERY',
    "linkTtlDays" INTEGER NOT NULL DEFAULT 60,
    "minOrderRub" INTEGER NOT NULL DEFAULT 0,
    "quarantineMode" "ReferralQuarantineMode" NOT NULL DEFAULT 'DELIVERED',
    "quarantineDays" INTEGER NOT NULL DEFAULT 7,
    "inviteeBonusEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inviteeBonusRub" INTEGER NOT NULL DEFAULT 0,
    "spendCapPercent" INTEGER NOT NULL DEFAULT 100,
    "shareText" TEXT NOT NULL DEFAULT 'Закажи в Miraflores по моей ссылке: {link}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ReferralSettings" ("id", "updatedAt")
VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "OrderReferralAttribution" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReferralAttribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderReferralAttribution_orderId_key" ON "OrderReferralAttribution"("orderId");
CREATE INDEX "OrderReferralAttribution_referrerUserId_createdAt_idx" ON "OrderReferralAttribution"("referrerUserId", "createdAt");
CREATE INDEX "OrderReferralAttribution_code_idx" ON "OrderReferralAttribution"("code");

ALTER TABLE "OrderReferralAttribution"
  ADD CONSTRAINT "OrderReferralAttribution_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderReferralAttribution"
  ADD CONSTRAINT "OrderReferralAttribution_referrerUserId_fkey"
  FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderReferralAttribution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderReferralAttribution" FORCE ROW LEVEL SECURITY;

CREATE POLICY order_referral_attribution_bypass ON "OrderReferralAttribution"
  FOR ALL
  USING (jcos_rls_bypass())
  WITH CHECK (jcos_rls_bypass());

CREATE TABLE "ReferralWalletLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReferralLedgerKind" NOT NULL,
    "status" "ReferralLedgerStatus" NOT NULL DEFAULT 'POSTED',
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER,
    "orderId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralWalletLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralWalletLedger_userId_idempotencyKey_key"
  ON "ReferralWalletLedger"("userId", "idempotencyKey");
CREATE INDEX "ReferralWalletLedger_userId_status_createdAt_idx"
  ON "ReferralWalletLedger"("userId", "status", "createdAt");
CREATE INDEX "ReferralWalletLedger_orderId_idx" ON "ReferralWalletLedger"("orderId");
CREATE INDEX "ReferralWalletLedger_kind_status_idx" ON "ReferralWalletLedger"("kind", "status");

ALTER TABLE "ReferralWalletLedger"
  ADD CONSTRAINT "ReferralWalletLedger_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReferralWalletLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReferralWalletLedger" FORCE ROW LEVEL SECURITY;

CREATE POLICY referral_wallet_ledger_all ON "ReferralWalletLedger"
  FOR ALL
  USING (jcos_rls_bypass() OR "userId" = jcos_rls_user_id())
  WITH CHECK (jcos_rls_bypass() OR "userId" = jcos_rls_user_id());
