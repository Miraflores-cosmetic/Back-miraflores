-- Multi-gift per gratitude rule: move variantId → GratitudeGiftRuleItem

CREATE TABLE "GratitudeGiftRuleItem" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GratitudeGiftRuleItem_pkey" PRIMARY KEY ("id")
);

-- Preserve existing single-gift rules (1 item per rule; id = ruleId + suffix)
INSERT INTO "GratitudeGiftRuleItem" ("id", "ruleId", "variantId", "sortOrder", "createdAt")
SELECT
  "id" || '_g0',
  "id",
  "variantId",
  0,
  CURRENT_TIMESTAMP
FROM "GratitudeGiftRule"
WHERE "variantId" IS NOT NULL AND btrim("variantId") <> '';

CREATE UNIQUE INDEX "GratitudeGiftRuleItem_ruleId_variantId_key" ON "GratitudeGiftRuleItem"("ruleId", "variantId");
CREATE INDEX "GratitudeGiftRuleItem_ruleId_sortOrder_idx" ON "GratitudeGiftRuleItem"("ruleId", "sortOrder");
CREATE INDEX "GratitudeGiftRuleItem_variantId_idx" ON "GratitudeGiftRuleItem"("variantId");

ALTER TABLE "GratitudeGiftRuleItem" ADD CONSTRAINT "GratitudeGiftRuleItem_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "GratitudeGiftRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GratitudeGiftRuleItem" ADD CONSTRAINT "GratitudeGiftRuleItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "GratitudeGiftRule_variantId_idx";
ALTER TABLE "GratitudeGiftRule" DROP CONSTRAINT IF EXISTS "GratitudeGiftRule_variantId_fkey";
ALTER TABLE "GratitudeGiftRule" DROP COLUMN "variantId";
