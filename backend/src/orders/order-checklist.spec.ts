import { describe, expect, it } from 'vitest';
import { isManualChecklistStep, serializeChecklistMarks } from './order-checklist';

describe('order-checklist', () => {
  it('accepts only manual steps of known checklists', () => {
    expect(isManualChecklistStep('ozon', 'packed')).toBe(true);
    expect(isManualChecklistStep('ozon', 'paid')).toBe(false);
    expect(isManualChecklistStep('cdek', 'packed')).toBe(false);
  });

  it('serializes marks with who and when', () => {
    const at = new Date('2026-09-27T10:00:00Z');
    const out = serializeChecklistMarks(
      [
        { checklist: 'ozon', stepId: 'picked', doneAt: at, doneByUserId: 'u1' },
        { checklist: 'ozon', stepId: 'label', doneAt: at, doneByUserId: 'u2' },
        { checklist: 'ozon', stepId: 'handed', doneAt: at, doneByUserId: null },
      ],
      new Map([
        ['u1', { email: 'a@x.ru', displayName: 'Аня' }],
        ['u2', { email: 'b@x.ru', displayName: null }],
      ]),
    );
    expect(out.ozon.picked).toEqual({ doneAt: at.toISOString(), doneBy: { id: 'u1', name: 'Аня' } });
    expect(out.ozon.label.doneBy?.name).toBe('b@x.ru');
    expect(out.ozon.handed.doneBy).toBeNull();
  });
});
