import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailService } from './mail.service';

describe('MailService templated customer mail', () => {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'FRONTEND_PUBLIC_URL') return 'https://shop.test';
      if (key === 'ORDER_AWAITING_TTL_MINUTES') return '60';
      if (key === 'SMTP_HOST') return 'smtp.test';
      if (key === 'SMTP_USER') return 'u';
      if (key === 'SMTP_PASSWORD') return 'p';
      if (key === 'MAIL_FROM') return 'from@test';
      return undefined;
    }),
  };

  const emailNotifications = {
    buildForEvent: vi.fn(),
    recordSendPath: vi.fn(async () => undefined),
  };

  let svc: MailService;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new MailService(config as never, emailNotifications as never);
    sendSpy = vi
      .spyOn(svc as unknown as { send: (p: unknown) => Promise<void> }, 'send')
      .mockResolvedValue(undefined);
  });

  it('sendOrderPaid использует шаблон из БД → rendered_db', async () => {
    emailNotifications.buildForEvent.mockResolvedValue({
      subject: 'Paid MF-1',
      text: 'ok',
      html: '<p>ok</p>',
    });
    await svc.sendOrderPaid({
      to: 'a@b.c',
      orderNumber: 'MF-1',
      total: 100,
      items: [{ title: 'X', qty: 1, lineTotal: 100 }],
    });
    expect(emailNotifications.buildForEvent).toHaveBeenCalledWith(
      'order_paid',
      expect.objectContaining({ 'order.number': 'MF-1' }),
    );
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.c', subject: 'Paid MF-1' }),
    );
    expect(emailNotifications.recordSendPath).toHaveBeenCalledWith(
      'order_paid',
      'rendered_db',
    );
  });

  it('выключенный шаблон — skipped_disabled', async () => {
    emailNotifications.buildForEvent.mockResolvedValue(null);
    await svc.sendOrderShipped({ to: 'a@b.c', orderNumber: 'MF-2' });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(emailNotifications.recordSendPath).toHaveBeenCalledWith(
      'order_shipped',
      'skipped_disabled',
    );
  });

  it('ошибка шаблона — rendered_legacy', async () => {
    emailNotifications.buildForEvent.mockRejectedValue(new Error('db down'));
    await svc.sendOrderDelivered({ to: 'a@b.c', orderNumber: 'MF-3' });
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@b.c',
        subject: expect.stringContaining('доставлен'),
      }),
    );
    expect(emailNotifications.recordSendPath).toHaveBeenCalledWith(
      'order_delivered',
      'rendered_legacy',
    );
  });

  it('sendAdminOrderNotify → mira-robot по умолчанию', async () => {
    await svc.sendAdminOrderNotify({
      kind: 'paid',
      orderNumber: 'MF-9',
      email: 'c@d.e',
      phone: '+7000',
      total: 100,
      customerName: 'Тест',
    });
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'mira-robot@miraflores-shop.ru',
        subject: expect.stringContaining('оплачен'),
      }),
    );
  });

  it('ORDER_ADMIN_NOTIFY_EMAIL пустой → skip admin notify', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'ORDER_ADMIN_NOTIFY_EMAIL') return '';
      if (key === 'FRONTEND_PUBLIC_URL') return 'https://shop.test';
      if (key === 'SMTP_HOST') return 'smtp.test';
      if (key === 'SMTP_USER') return 'u';
      if (key === 'SMTP_PASSWORD') return 'p';
      if (key === 'MAIL_FROM') return 'from@test';
      return undefined;
    });
    await svc.sendAdminOrderNotify({
      kind: 'created',
      orderNumber: 'MF-0',
      email: 'c@d.e',
      phone: '1',
      total: 1,
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('awaiting_payment собирает guest pay deep-link', async () => {
    emailNotifications.buildForEvent.mockResolvedValue({
      subject: 'Pay',
      text: 'p',
      html: '<p>p</p>',
    });
    await svc.sendOrderAwaitingPayment({
      to: 'a@b.c',
      orderNumber: 'MF-9',
      total: 500,
      orderId: 'ord9',
      payToken: 'tok9',
      stage: 1,
    });
    expect(emailNotifications.buildForEvent).toHaveBeenCalledWith(
      'order_awaiting_payment',
      expect.objectContaining({
        'order.pay_url':
          'https://shop.test/order/pay?orderId=ord9&payToken=tok9&number=MF-9',
      }),
    );

    emailNotifications.buildForEvent.mockClear();
    await svc.sendOrderAwaitingPayment({
      to: 'a@b.c',
      orderNumber: 'MF-9',
      total: 500,
      stage: 2,
    });
    expect(emailNotifications.buildForEvent).toHaveBeenCalledWith(
      'order_awaiting_payment_24h',
      expect.any(Object),
    );

    emailNotifications.buildForEvent.mockClear();
    await svc.sendOrderAwaitingPayment({
      to: 'a@b.c',
      orderNumber: 'MF-9',
      total: 500,
      stage: 3,
      cancelAtLabel: '23.10.2026, 15:00',
    });
    expect(emailNotifications.buildForEvent).toHaveBeenCalledWith(
      'order_awaiting_payment_48h',
      expect.objectContaining({
        'order.cancel_at_label': '23.10.2026, 15:00',
      }),
    );
  });

  it('sendGiftCertificateIssued идёт через gift_issued', async () => {
    emailNotifications.buildForEvent.mockResolvedValue({
      subject: 'Gift',
      text: 'g',
      html: '<p>g</p>',
    });
    await svc.sendGiftCertificateIssued({
      to: 'a@b.c',
      items: [{ code: 'ABC', faceValue: 1000, expiresAt: null }],
    });
    expect(emailNotifications.buildForEvent).toHaveBeenCalledWith(
      'gift_issued',
      expect.objectContaining({ 'gift.items_text': expect.stringContaining('ABC') }),
    );
  });
});
