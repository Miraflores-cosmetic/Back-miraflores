-- Один TRACKING_SENT на заказ (admin vs CDEK sync).
DELETE FROM "OrderEvent" e
USING "OrderEvent" older
WHERE e."orderId" = older."orderId"
  AND e.type = 'TRACKING_SENT'
  AND older.type = 'TRACKING_SENT'
  AND (
    e."createdAt" > older."createdAt"
    OR (e."createdAt" = older."createdAt" AND e.id > older.id)
  );

CREATE UNIQUE INDEX "OrderEvent_orderId_tracking_sent_key"
  ON "OrderEvent" ("orderId")
  WHERE type = 'TRACKING_SENT';