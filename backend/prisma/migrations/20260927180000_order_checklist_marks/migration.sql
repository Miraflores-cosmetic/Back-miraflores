-- Чеклист склада на сервере (раньше — localStorage браузера)
CREATE TABLE "OrderChecklistMark" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "checklist" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "doneByUserId" TEXT,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderChecklistMark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderChecklistMark_orderId_checklist_stepId_key"
  ON "OrderChecklistMark"("orderId", "checklist", "stepId");

ALTER TABLE "OrderChecklistMark"
  ADD CONSTRAINT "OrderChecklistMark_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: служебные отметки склада — только staff / системный bypass (покупателю не видны)
ALTER TABLE "OrderChecklistMark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderChecklistMark" FORCE ROW LEVEL SECURITY;

CREATE POLICY order_checklist_mark_bypass ON "OrderChecklistMark"
  FOR ALL
  USING (jcos_rls_bypass())
  WITH CHECK (jcos_rls_bypass());
