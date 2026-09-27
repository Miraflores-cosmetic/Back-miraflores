/**
 * Ручные шаги чеклистов склада. Авто-шаги (оплата, трек, письмо, стоимость) считаются
 * по данным заказа в админке и на сервере не хранятся.
 */
export const ORDER_CHECKLIST_MANUAL_STEPS = {
  ozon: ['picked', 'packed', 'created', 'label', 'handed'],
} as const satisfies Record<string, readonly string[]>;

export type OrderChecklistId = keyof typeof ORDER_CHECKLIST_MANUAL_STEPS;

export function isManualChecklistStep(checklist: string, stepId: string): checklist is OrderChecklistId {
  const steps = (ORDER_CHECKLIST_MANUAL_STEPS as Record<string, readonly string[]>)[checklist];
  return Boolean(steps?.includes(stepId));
}

export type ChecklistMarkView = {
  doneAt: string;
  doneBy: { id: string; name: string } | null;
};

/** { ozon: { picked: { doneAt, doneBy } } } — для карточки заказа. */
export function serializeChecklistMarks(
  marks: Array<{ checklist: string; stepId: string; doneAt: Date; doneByUserId: string | null }>,
  users: Map<string, { email: string; displayName: string | null }>,
): Record<string, Record<string, ChecklistMarkView>> {
  const out: Record<string, Record<string, ChecklistMarkView>> = {};
  for (const m of marks) {
    const u = m.doneByUserId ? users.get(m.doneByUserId) : undefined;
    (out[m.checklist] ??= {})[m.stepId] = {
      doneAt: m.doneAt.toISOString(),
      doneBy: m.doneByUserId
        ? { id: m.doneByUserId, name: u?.displayName?.trim() || u?.email || 'сотрудник' }
        : null,
    };
  }
  return out;
}
