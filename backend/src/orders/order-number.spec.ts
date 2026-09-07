import { describe, expect, it } from 'vitest';
import { formatOrderNumber } from './order-number';

describe('formatOrderNumber', () => {
  it('форматирует AA-000001 … AA-000002', () => {
    expect(formatOrderNumber(1)).toBe('AA-000001');
    expect(formatOrderNumber(2)).toBe('AA-000002');
    expect(formatOrderNumber(4281)).toBe('AA-004281');
  });

  it('отклоняет вне диапазона', () => {
    expect(() => formatOrderNumber(0)).toThrow();
    expect(() => formatOrderNumber(1_000_000)).toThrow();
  });
});
