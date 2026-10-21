import { describe, expect, it } from 'vitest';
import { buildAdminOrderNotifyEmail } from './admin-order-notify';

describe('buildAdminOrderNotifyEmail', () => {
  it('created включает состав', () => {
    const mail = buildAdminOrderNotifyEmail({
      kind: 'created',
      orderNumber: 'MF-1',
      customerName: 'Иван Иванов',
      email: 'a@b.c',
      phone: '+79991234567',
      total: 2500,
      items: [{ title: 'Крем', qty: 2, lineTotal: 2500 }],
      siteUrl: 'https://shop.test',
    });
    expect(mail.subject).toContain('Новый заказ');
    expect(mail.subject).toContain('MF-1');
    expect(mail.text).toContain('Иван Иванов');
    expect(mail.text).toContain('a@b.c');
    expect(mail.text).toContain('+79991234567');
    expect(mail.text).toContain('Крем');
    expect(mail.html).toContain('Крем');
  });

  it('paid / cancelled / refunded — без состава, refund с суммой', () => {
    const paid = buildAdminOrderNotifyEmail({
      kind: 'paid',
      orderNumber: 'MF-2',
      email: 'a@b.c',
      phone: '1',
      total: 100,
    });
    expect(paid.subject).toContain('оплачен');
    expect(paid.text).not.toContain('Состав');

    const cancelled = buildAdminOrderNotifyEmail({
      kind: 'cancelled',
      orderNumber: 'MF-3',
      email: 'a@b.c',
      phone: '1',
      total: 100,
      cancelReason: 'TTL',
    });
    expect(cancelled.subject).toContain('отменён');
    expect(cancelled.text).toContain('TTL');

    const refunded = buildAdminOrderNotifyEmail({
      kind: 'refunded',
      orderNumber: 'MF-4',
      email: 'a@b.c',
      phone: '1',
      total: 1000,
      refundAmount: 500,
    });
    expect(refunded.subject).toContain('Возврат');
    expect(refunded.text).toMatch(/500/);
  });
});
