-- Дубли (orderId, externalId): оставляем «лучшую» строку, остальные удаляем.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "orderId", "externalId"
      ORDER BY
        CASE status::text
          WHEN 'SUCCEEDED' THEN 0
          WHEN 'REFUNDED' THEN 1
          WHEN 'PENDING' THEN 2
          WHEN 'CANCELED' THEN 3
          ELSE 4
        END,
        "createdAt" ASC
    ) AS rn
  FROM "Payment"
  WHERE "externalId" IS NOT NULL
)
DELETE FROM "Payment"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX "Payment_orderId_externalId_key" ON "Payment"("orderId", "externalId");
