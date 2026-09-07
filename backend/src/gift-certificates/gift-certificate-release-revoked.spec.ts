import { describe, expect, it, vi } from 'vitest';
import { GiftCertificateLedgerKind, GiftCertificateStatus } from '@prisma/client';
import { releaseGiftCertificateForOrder } from './gift-certificate-hold.util';

describe('releaseGiftCertificateForOrder + REVOKED', () => {
  it('пишет RELEASE без восстановления баланса, если сертификат уже REVOKED', async () => {
    const create = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = String(strings);
        if (sql.includes('current_setting')) return [{ v: 'off' }];
        return [
          {
            id: 'c1',
            code: 'JC-AAAA-BBBB-CCCC',
            balance: 0,
            faceValue: 1000,
            status: GiftCertificateStatus.REVOKED,
            expiresAt: null,
          },
        ];
      }),
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      giftCertificate: { update },
      giftCertificateLedger: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              certificateId: 'c1',
              amount: -400,
              kind: GiftCertificateLedgerKind.CAPTURE,
            },
          ])
          .mockResolvedValueOnce([]),
        create,
      },
    };

    const ok = await releaseGiftCertificateForOrder(tx as never, 'ord1', {
      note: 'cancel',
    });

    expect(ok).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: GiftCertificateLedgerKind.RELEASE,
          amount: 400,
          balanceAfter: 0,
          note: expect.stringMatching(/отозван/i),
        }),
      }),
    );
  });
});
