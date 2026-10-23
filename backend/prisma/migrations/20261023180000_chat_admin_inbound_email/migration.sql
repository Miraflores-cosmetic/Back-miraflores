-- Throttle ops-писем админу при входящих сообщениях клиента в чате.
ALTER TABLE "ChatConversation"
  ADD COLUMN IF NOT EXISTS "lastCustomerInboundAdminEmailAt" TIMESTAMP(3);
