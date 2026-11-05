ALTER TABLE "ProductVariant"
  ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: отдельное слово «прobник» (не «непрobник»).
UPDATE "ProductVariant"
SET "isSample" = true
WHERE "isSample" = false
  AND (
    lower(trim(name)) = 'пробник'
    OR name ~* '(^|[^[:alnum:]])пробник($|[^[:alnum:]])'
  );
