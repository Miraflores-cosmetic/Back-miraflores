-- Case-insensitive unique(kind, label): collapse «Крем»/«крем» and enforce lower(label).

-- 1) Pick winners per (kind, lower(label)): earliest sortOrder, then createdAt, then id
CREATE TEMP TABLE "_attr_ci_winners" ON COMMIT DROP AS
SELECT DISTINCT ON (kind, lower(label))
  id AS winner_id,
  kind,
  lower(label) AS label_ci
FROM "ProductAttributeOption"
ORDER BY kind, lower(label), "sortOrder" ASC, "createdAt" ASC, id ASC;

CREATE TEMP TABLE "_attr_ci_losers" ON COMMIT DROP AS
SELECT o.id AS loser_id, w.winner_id
FROM "ProductAttributeOption" o
JOIN "_attr_ci_winners" w
  ON w.kind = o.kind AND w.label_ci = lower(o.label)
WHERE o.id <> w.winner_id;

-- 2) Repoint Product FKs from losers → winners
UPDATE "Product" p
SET "productTypeOptionId" = l.winner_id
FROM "_attr_ci_losers" l
WHERE p."productTypeOptionId" = l.loser_id;

UPDATE "Product" p
SET "purposeOptionId" = l.winner_id
FROM "_attr_ci_losers" l
WHERE p."purposeOptionId" = l.loser_id;

UPDATE "Product" p
SET "shelfLifeOptionId" = l.winner_id
FROM "_attr_ci_losers" l
WHERE p."shelfLifeOptionId" = l.loser_id;

UPDATE "Product" p
SET "storageOptionId" = l.winner_id
FROM "_attr_ci_losers" l
WHERE p."storageOptionId" = l.loser_id;

-- Sync denormalized labels to winner label (exact casing of kept row)
UPDATE "Product" p
SET "productType" = o.label
FROM "ProductAttributeOption" o
WHERE p."productTypeOptionId" = o.id
  AND p."productType" IS DISTINCT FROM o.label;

UPDATE "Product" p
SET "purpose" = o.label
FROM "ProductAttributeOption" o
WHERE p."purposeOptionId" = o.id
  AND p."purpose" IS DISTINCT FROM o.label;

UPDATE "Product" p
SET "shelfLife" = o.label
FROM "ProductAttributeOption" o
WHERE p."shelfLifeOptionId" = o.id
  AND p."shelfLife" IS DISTINCT FROM o.label;

UPDATE "Product" p
SET "storageHtml" = o.label
FROM "ProductAttributeOption" o
WHERE p."storageOptionId" = o.id
  AND p."storageHtml" IS DISTINCT FROM o.label;

-- 3) Drop duplicate option rows
DELETE FROM "ProductAttributeOption" o
USING "_attr_ci_losers" l
WHERE o.id = l.loser_id;

-- 4) Replace case-sensitive unique with CI unique
DROP INDEX IF EXISTS "ProductAttributeOption_kind_label_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ProductAttributeOption_kind_label_ci_key"
  ON "ProductAttributeOption" ("kind", lower("label"));
