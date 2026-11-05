ALTER TABLE "CartSettings"
  ADD COLUMN IF NOT EXISTS "sampleRulesArticleSlug" TEXT,
  ADD COLUMN IF NOT EXISTS "sampleVariantNoticeHtml" TEXT;
