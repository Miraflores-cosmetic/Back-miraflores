-- Outbox flush: не сканировать весь TRACKING_SENT / DELIVERED.
CREATE INDEX "OrderEvent_tracking_mail_outbox_flush_idx"
  ON "OrderEvent" ("createdAt" ASC)
  WHERE type = 'TRACKING_SENT'
    AND (meta->>'mailStatus') IN ('pending', 'failed');

CREATE INDEX "OrderEvent_delivered_cdek_mail_outbox_flush_idx"
  ON "OrderEvent" ("createdAt" ASC)
  WHERE type = 'DELIVERED'
    AND (meta->>'source') = 'cdek_sync'
    AND (meta->>'mailStatus') IN ('pending', 'failed');