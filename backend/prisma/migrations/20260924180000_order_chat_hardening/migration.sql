-- Idempotency + email throttle + RLS for order chat

ALTER TABLE "ChatConversation"
  ADD COLUMN IF NOT EXISTS "lastStaffReplyEmailAt" TIMESTAMP(3);

ALTER TABLE "ChatMessage"
  ADD COLUMN IF NOT EXISTS "clientMessageId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessage_conversationId_clientMessageId_key"
  ON "ChatMessage"("conversationId", "clientMessageId");

-- ─── ChatConversation ───────────────────────────────────────────────
ALTER TABLE "ChatConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatConversation" FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_conversation_all ON "ChatConversation"
  FOR ALL
  USING (
    jcos_rls_bypass()
    OR ("userId" IS NOT NULL AND "userId" = jcos_rls_user_id())
    OR EXISTS (
      SELECT 1 FROM "Order" o
      WHERE o.id = "ChatConversation"."orderId"
        AND o."userId" IS NOT NULL
        AND o."userId" = jcos_rls_user_id()
    )
  )
  WITH CHECK (
    jcos_rls_bypass()
    OR ("userId" IS NOT NULL AND "userId" = jcos_rls_user_id())
    OR EXISTS (
      SELECT 1 FROM "Order" o
      WHERE o.id = "ChatConversation"."orderId"
        AND o."userId" IS NOT NULL
        AND o."userId" = jcos_rls_user_id()
    )
  );

-- ─── ChatMessage ────────────────────────────────────────────────────
ALTER TABLE "ChatMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessage" FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_message_all ON "ChatMessage"
  FOR ALL
  USING (
    jcos_rls_bypass()
    OR EXISTS (
      SELECT 1 FROM "ChatConversation" c
      WHERE c.id = "ChatMessage"."conversationId"
        AND (
          (c."userId" IS NOT NULL AND c."userId" = jcos_rls_user_id())
          OR EXISTS (
            SELECT 1 FROM "Order" o
            WHERE o.id = c."orderId"
              AND o."userId" IS NOT NULL
              AND o."userId" = jcos_rls_user_id()
          )
        )
    )
  )
  WITH CHECK (
    jcos_rls_bypass()
    OR EXISTS (
      SELECT 1 FROM "ChatConversation" c
      WHERE c.id = "ChatMessage"."conversationId"
        AND (
          (c."userId" IS NOT NULL AND c."userId" = jcos_rls_user_id())
          OR EXISTS (
            SELECT 1 FROM "Order" o
            WHERE o.id = c."orderId"
              AND o."userId" IS NOT NULL
              AND o."userId" = jcos_rls_user_id()
          )
        )
    )
  );

-- ─── ChatAttachment ─────────────────────────────────────────────────
ALTER TABLE "ChatAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatAttachment" FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_attachment_all ON "ChatAttachment"
  FOR ALL
  USING (
    jcos_rls_bypass()
    OR EXISTS (
      SELECT 1 FROM "ChatMessage" m
      JOIN "ChatConversation" c ON c.id = m."conversationId"
      WHERE m.id = "ChatAttachment"."messageId"
        AND (
          (c."userId" IS NOT NULL AND c."userId" = jcos_rls_user_id())
          OR EXISTS (
            SELECT 1 FROM "Order" o
            WHERE o.id = c."orderId"
              AND o."userId" IS NOT NULL
              AND o."userId" = jcos_rls_user_id()
          )
        )
    )
  )
  WITH CHECK (
    jcos_rls_bypass()
    OR EXISTS (
      SELECT 1 FROM "ChatMessage" m
      JOIN "ChatConversation" c ON c.id = m."conversationId"
      WHERE m.id = "ChatAttachment"."messageId"
        AND (
          (c."userId" IS NOT NULL AND c."userId" = jcos_rls_user_id())
          OR EXISTS (
            SELECT 1 FROM "Order" o
            WHERE o.id = c."orderId"
              AND o."userId" IS NOT NULL
              AND o."userId" = jcos_rls_user_id()
          )
        )
    )
  );

-- ─── ChatReadState ──────────────────────────────────────────────────
ALTER TABLE "ChatReadState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatReadState" FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_read_state_all ON "ChatReadState"
  FOR ALL
  USING (jcos_rls_bypass() OR "userId" = jcos_rls_user_id())
  WITH CHECK (jcos_rls_bypass() OR "userId" = jcos_rls_user_id());
