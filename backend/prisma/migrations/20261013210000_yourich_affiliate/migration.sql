-- Партнёрка YouRich: флаги промо + outbox лидов + индексы для firstOrderOnly
ALTER TABLE "PromoCode" ADD COLUMN "codeRaw" TEXT;
ALTER TABLE "PromoCode" ADD COLUMN "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PromoCode" ADD COLUMN "affiliate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PromoCode" ADD COLUMN "yourichPromoId" INTEGER;

CREATE UNIQUE INDEX "PromoCode_yourichPromoId_key" ON "PromoCode"("yourichPromoId");

CREATE INDEX "Order_email_idx" ON "Order"("email");
CREATE INDEX "Order_phone_idx" ON "Order"("phone");

CREATE TABLE "OrderAffiliateLead" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "leadCrmId" TEXT NOT NULL,
    "refHash" TEXT,
    "extUserId" TEXT,
    "promoCodeRaw" TEXT,
    "offerId" INTEGER,
    "leadId" INTEGER,
    "lastSentEvent" TEXT,
    "lastSentSum" INTEGER,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastHttpStatus" INTEGER,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderAffiliateLead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderAffiliateLead_orderId_key" ON "OrderAffiliateLead"("orderId");
CREATE INDEX "OrderAffiliateLead_state_nextAttemptAt_idx" ON "OrderAffiliateLead"("state", "nextAttemptAt");
CREATE INDEX "OrderAffiliateLead_leadCrmId_idx" ON "OrderAffiliateLead"("leadCrmId");

ALTER TABLE "OrderAffiliateLead"
  ADD CONSTRAINT "OrderAffiliateLead_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderAffiliateLead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderAffiliateLead" FORCE ROW LEVEL SECURITY;

CREATE POLICY order_affiliate_lead_bypass ON "OrderAffiliateLead"
  FOR ALL
  USING (jcos_rls_bypass())
  WITH CHECK (jcos_rls_bypass());
