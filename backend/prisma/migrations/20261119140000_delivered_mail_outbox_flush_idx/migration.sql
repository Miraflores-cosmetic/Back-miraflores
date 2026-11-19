DROP INDEX IF EXISTS "OrderEvent_delivered_cdek_mail_outbox_flush_idx";

CREATE INDEX "OrderEvent_delivered_mail_outbox_flush_idx"
  ON "OrderEvent" ("createdAt" ASC)
  WHERE type = 'DELIVERED'
    AND (meta->>'source') IN ('cdek_sync', 'admin_manual')
    AND (meta->>'mailStatus') IN ('pending', 'failed');