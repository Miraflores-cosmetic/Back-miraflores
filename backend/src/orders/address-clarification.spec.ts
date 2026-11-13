import { describe, expect, it } from 'vitest';
import {
  ADDRESS_CLARIFICATION_MARKER,
  buildAddressClarificationComment,
  hasAddressClarificationEvidence,
  stripAddressClarificationFromComment,
} from './address-clarification';

describe('address-clarification', () => {
  it('принимает marker в comment', () => {
    expect(
      hasAddressClarificationEvidence({
        comment: `Тип доставки: Уточнит оператор.\n${ADDRESS_CLARIFICATION_MARKER}`,
        address: 'Что угодно',
      }),
    ).toBe(true);
  });

  it('принимает синтетический адрес без marker', () => {
    expect(
      hasAddressClarificationEvidence({
        comment: '',
        address: 'Адрес уточнит оператор',
      }),
    ).toBe(true);
  });

  it('отклоняет spoof без evidence', () => {
    expect(
      hasAddressClarificationEvidence({
        comment: 'Тип доставки: СДЭК ПВЗ',
        address: 'Тверская 1',
      }),
    ).toBe(false);
  });

  it('stripAddressClarificationFromComment сохраняет JCOS meta', () => {
    const raw = `__JCOS:carrier=cdek|dropoff=courier|lon=1|lat=2|cc=RU__\nТип доставки: Уточнит оператор.\n${ADDRESS_CLARIFICATION_MARKER}`;
    expect(stripAddressClarificationFromComment(raw)).toBe(
      '__JCOS:carrier=cdek|dropoff=courier|lon=1|lat=2|cc=RU__',
    );
  });

  it('buildAddressClarificationComment добавляет marker', () => {
    const withMarker = buildAddressClarificationComment('note');
    expect(withMarker).toContain(ADDRESS_CLARIFICATION_MARKER);
    expect(withMarker).toContain('note');
    expect(
      buildAddressClarificationComment(
        `x\n${ADDRESS_CLARIFICATION_MARKER}`,
      ),
    ).toBe(`x\n${ADDRESS_CLARIFICATION_MARKER}`);
  });
});
