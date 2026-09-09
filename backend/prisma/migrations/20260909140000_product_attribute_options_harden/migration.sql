-- Harden ProductAttributeOption: unique(kind,label), backfill from Product DISTINCT,
-- normalize storageHtml to plain text for attribute selects.

-- 1) Normalize storageHtml: strip tags → plain (best-effort), empty → NULL
UPDATE "Product"
SET "storageHtml" = NULLIF(
  TRIM(
    regexp_replace(
      regexp_replace(
        regexp_replace("storageHtml", '(?i)<br\\s*/?>', ' ', 'g'),
        '(?i)</p>',
        ' ',
        'g'
      ),
      '<[^>]+>',
      ' ',
      'g'
    )
  ),
  ''
)
WHERE "storageHtml" IS NOT NULL
  AND "storageHtml" ~ '<[^>]+>';

UPDATE "Product"
SET "storageHtml" = NULLIF(TRIM(regexp_replace("storageHtml", '\\s+', ' ', 'g')), '')
WHERE "storageHtml" IS NOT NULL;

-- 2) Deduplicate existing options (keep earliest sortOrder / id)
DELETE FROM "ProductAttributeOption" a
USING "ProductAttributeOption" b
WHERE a."kind" = b."kind"
  AND a."label" = b."label"
  AND a."id" > b."id";

-- 3) Unique (kind, label)
CREATE UNIQUE INDEX IF NOT EXISTS "ProductAttributeOption_kind_label_key"
  ON "ProductAttributeOption"("kind", "label");

-- 4) Backfill from DISTINCT Product fields (skip empties / already present)
INSERT INTO "ProductAttributeOption" ("id", "kind", "label", "sortOrder", "active", "createdAt", "updatedAt")
SELECT
  md5('productType:' || val),
  'productType'::"ProductAttributeKind",
  val,
  (ROW_NUMBER() OVER (ORDER BY val) - 1)::int,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT TRIM("productType") AS val
  FROM "Product"
  WHERE "productType" IS NOT NULL AND TRIM("productType") <> ''
) s
WHERE NOT EXISTS (
  SELECT 1 FROM "ProductAttributeOption" o
  WHERE o."kind" = 'productType'::"ProductAttributeKind" AND o."label" = s.val
);

INSERT INTO "ProductAttributeOption" ("id", "kind", "label", "sortOrder", "active", "createdAt", "updatedAt")
SELECT
  md5('purpose:' || val),
  'purpose'::"ProductAttributeKind",
  val,
  (ROW_NUMBER() OVER (ORDER BY val) - 1)::int,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT TRIM("purpose") AS val
  FROM "Product"
  WHERE "purpose" IS NOT NULL AND TRIM("purpose") <> ''
) s
WHERE NOT EXISTS (
  SELECT 1 FROM "ProductAttributeOption" o
  WHERE o."kind" = 'purpose'::"ProductAttributeKind" AND o."label" = s.val
);

INSERT INTO "ProductAttributeOption" ("id", "kind", "label", "sortOrder", "active", "createdAt", "updatedAt")
SELECT
  md5('shelfLife:' || val),
  'shelfLife'::"ProductAttributeKind",
  val,
  (ROW_NUMBER() OVER (ORDER BY val) - 1)::int,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT TRIM("shelfLife") AS val
  FROM "Product"
  WHERE "shelfLife" IS NOT NULL AND TRIM("shelfLife") <> ''
) s
WHERE NOT EXISTS (
  SELECT 1 FROM "ProductAttributeOption" o
  WHERE o."kind" = 'shelfLife'::"ProductAttributeKind" AND o."label" = s.val
);

INSERT INTO "ProductAttributeOption" ("id", "kind", "label", "sortOrder", "active", "createdAt", "updatedAt")
SELECT
  md5('storage:' || val),
  'storage'::"ProductAttributeKind",
  val,
  (ROW_NUMBER() OVER (ORDER BY val) - 1)::int,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT TRIM("storageHtml") AS val
  FROM "Product"
  WHERE "storageHtml" IS NOT NULL AND TRIM("storageHtml") <> ''
) s
WHERE NOT EXISTS (
  SELECT 1 FROM "ProductAttributeOption" o
  WHERE o."kind" = 'storage'::"ProductAttributeKind" AND o."label" = s.val
);
