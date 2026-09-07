-- Soft-reject: аудит отказанных отзывов без hard DELETE
ALTER TABLE "ProductReview" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
ALTER TABLE "ProductReview" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

CREATE INDEX IF NOT EXISTS "ProductReview_rejectedAt_idx" ON "ProductReview"("rejectedAt");
