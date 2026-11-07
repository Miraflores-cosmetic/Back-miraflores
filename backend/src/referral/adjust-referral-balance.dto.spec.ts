import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AdjustReferralBalanceDto } from './dto/adjust-referral-balance.dto';

describe('AdjustReferralBalanceDto', () => {
  async function errorsFor(raw: Record<string, unknown>) {
    const dto = plainToInstance(AdjustReferralBalanceDto, raw);
    return validate(dto);
  }

  it('отклоняет amount=0 (DTO, не только service)', async () => {
    const errs = await errorsFor({ amount: 0 });
    expect(errs.some((e) => e.property === 'amount')).toBe(true);
  });

  it('принимает ±ненулевую сумму', async () => {
    expect(await errorsFor({ amount: 100 })).toHaveLength(0);
    expect(await errorsFor({ amount: -50, note: 'тест' })).toHaveLength(0);
  });
});
