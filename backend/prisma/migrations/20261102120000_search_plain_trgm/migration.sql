-- Plain-text search columns + pg_trgm GIN (ILIKE %q% without seq scan on HTML TEXT)
-- Product.compositionSearchText = strip(composition + description + actionEffect)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "compositionSearchText" TEXT;
ALTER TABLE "BlogPost" ADD COLUMN IF NOT EXISTS "bodySearchText" TEXT;

UPDATE "Product"
SET "compositionSearchText" = NULLIF(
  btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          concat_ws(
            E'\n',
            coalesce("compositionHtml", ''),
            coalesce("descriptionHtml", ''),
            coalesce("actionEffectHtml", '')
          ),
          '(?i)<script[\s\S]*?</script>', ' ', 'g'
        ),
        '(?i)<style[\s\S]*?</style>', ' ', 'g'
      ),
      '<[^>]+>', ' ', 'g'
    )
  ),
  ''
)
WHERE (
  coalesce("compositionHtml", '') <> ''
  OR coalesce("descriptionHtml", '') <> ''
  OR coalesce("actionEffectHtml", '') <> ''
);

UPDATE "BlogPost"
SET "bodySearchText" = NULLIF(
  btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce("body", ''), '(?i)<script[\s\S]*?</script>', ' ', 'g'),
        '(?i)<style[\s\S]*?</style>', ' ', 'g'
      ),
      '<[^>]+>', ' ', 'g'
    )
  ),
  ''
)
WHERE btrim(coalesce("body", '')) <> '';

CREATE INDEX IF NOT EXISTS "Product_compositionSearchText_trgm_idx"
  ON "Product" USING gin ("compositionSearchText" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "BlogPost_bodySearchText_trgm_idx"
  ON "BlogPost" USING gin ("bodySearchText" gin_trgm_ops);
