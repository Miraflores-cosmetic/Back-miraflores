-- Product → ProductAttributeOption FKs + catalog revision for optimistic concurrency.

-- 1) Singleton revision row
CREATE TABLE IF NOT EXISTS "ProductAttributeCatalog" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductAttributeCatalog_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ProductAttributeCatalog" ("id", "version", "updatedAt")
VALUES ('default', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 2) FK columns on Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "productTypeOptionId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "purposeOptionId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shelfLifeOptionId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "storageOptionId" TEXT;

-- 3) Backfill from denormalized labels
UPDATE "Product" p
SET "productTypeOptionId" = o."id"
FROM "ProductAttributeOption" o
WHERE p."productTypeOptionId" IS NULL
  AND p."productType" IS NOT NULL
  AND TRIM(p."productType") <> ''
  AND o."kind" = 'productType'::"ProductAttributeKind"
  AND o."label" = TRIM(p."productType");

UPDATE "Product" p
SET "purposeOptionId" = o."id"
FROM "ProductAttributeOption" o
WHERE p."purposeOptionId" IS NULL
  AND p."purpose" IS NOT NULL
  AND TRIM(p."purpose") <> ''
  AND o."kind" = 'purpose'::"ProductAttributeKind"
  AND o."label" = TRIM(p."purpose");

UPDATE "Product" p
SET "shelfLifeOptionId" = o."id"
FROM "ProductAttributeOption" o
WHERE p."shelfLifeOptionId" IS NULL
  AND p."shelfLife" IS NOT NULL
  AND TRIM(p."shelfLife") <> ''
  AND o."kind" = 'shelfLife'::"ProductAttributeKind"
  AND o."label" = TRIM(p."shelfLife");

UPDATE "Product" p
SET "storageOptionId" = o."id"
FROM "ProductAttributeOption" o
WHERE p."storageOptionId" IS NULL
  AND p."storageHtml" IS NOT NULL
  AND TRIM(p."storageHtml") <> ''
  AND o."kind" = 'storage'::"ProductAttributeKind"
  AND o."label" = TRIM(p."storageHtml");

-- 4) Indexes + FKs
CREATE INDEX IF NOT EXISTS "Product_productTypeOptionId_idx" ON "Product"("productTypeOptionId");
CREATE INDEX IF NOT EXISTS "Product_purposeOptionId_idx" ON "Product"("purposeOptionId");
CREATE INDEX IF NOT EXISTS "Product_shelfLifeOptionId_idx" ON "Product"("shelfLifeOptionId");
CREATE INDEX IF NOT EXISTS "Product_storageOptionId_idx" ON "Product"("storageOptionId");

DO $$ BEGIN
  ALTER TABLE "Product"
    ADD CONSTRAINT "Product_productTypeOptionId_fkey"
    FOREIGN KEY ("productTypeOptionId") REFERENCES "ProductAttributeOption"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Product"
    ADD CONSTRAINT "Product_purposeOptionId_fkey"
    FOREIGN KEY ("purposeOptionId") REFERENCES "ProductAttributeOption"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Product"
    ADD CONSTRAINT "Product_shelfLifeOptionId_fkey"
    FOREIGN KEY ("shelfLifeOptionId") REFERENCES "ProductAttributeOption"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Product"
    ADD CONSTRAINT "Product_storageOptionId_fkey"
    FOREIGN KEY ("storageOptionId") REFERENCES "ProductAttributeOption"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
