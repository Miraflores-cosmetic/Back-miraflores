INSERT INTO "BackgroundWorkerLease" ("key", "holder", "expiresAt", "updatedAt")
VALUES
  ('awaiting_payment_remind', '', TIMESTAMP '1970-01-01 00:00:00', CURRENT_TIMESTAMP),
  ('order_chat_retention', '', TIMESTAMP '1970-01-01 00:00:00', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;