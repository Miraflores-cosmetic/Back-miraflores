import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailNotificationsService } from './email-notifications.service';

describe('EmailNotificationsService', () => {
  const prisma = {
    emailNotificationTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      createMany: vi.fn(),
      upsert: vi.fn(),
    },
    emailNotificationTemplateRevision: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => unknown) => fn(prisma)),
    $executeRaw: vi.fn(),
  };
  const config = {
    get: vi.fn((key: string) =>
      key === 'FRONTEND_PUBLIC_URL' ? 'https://shop.test' : undefined,
    ),
  };

  let svc: EmailNotificationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.emailNotificationTemplate.findMany.mockResolvedValue([]);
    prisma.emailNotificationTemplate.createMany.mockResolvedValue({ count: 0 });
    prisma.emailNotificationTemplateRevision.findMany.mockResolvedValue([]);
    prisma.emailNotificationTemplateRevision.create.mockResolvedValue({});
    prisma.emailNotificationTemplate.upsert.mockResolvedValue({});
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    svc = new EmailNotificationsService(prisma as never, config as never);
  });

  it('list сидит defaults и возвращает все события', async () => {
    prisma.emailNotificationTemplate.findMany
      .mockResolvedValueOnce([]) // ensureDefaults existing
      .mockResolvedValueOnce([]); // list rows
    const list = await svc.list();
    expect(list.length).toBeGreaterThanOrEqual(11);
    expect(list.some((i) => i.eventKey === 'order_awaiting_payment')).toBe(
      true,
    );
    expect(prisma.emailNotificationTemplate.createMany).toHaveBeenCalled();
  });

  it('get неизвестного ключа → 404', async () => {
    await expect(svc.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update отклоняет неизвестные переменные', async () => {
    prisma.emailNotificationTemplate.findUnique.mockResolvedValue({
      eventKey: 'order_paid',
      enabled: true,
      subject: 'x',
      body: 'y',
      updatedAt: new Date(),
    });
    await expect(
      svc.update('order_paid', { body: 'Hi {{evil.token}}' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update отклоняет недопустимый {{#if}}', async () => {
    prisma.emailNotificationTemplate.findUnique.mockResolvedValue({
      eventKey: 'order_paid',
      enabled: true,
      subject: 'x',
      body: 'y',
      updatedAt: new Date(),
    });
    await expect(
      svc.update('order_paid', {
        body: '{{#if evil.x}}nope{{/if}}',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update пишет revision и actor', async () => {
    prisma.emailNotificationTemplate.findMany.mockResolvedValue([
      { eventKey: 'order_paid' },
    ]);
    prisma.emailNotificationTemplate.findUnique
      .mockResolvedValueOnce({
        eventKey: 'order_paid',
        enabled: true,
        subject: 'Old',
        body: 'Old body',
        updatedAt: new Date(),
      })
      // get() after update
      .mockResolvedValue({
        eventKey: 'order_paid',
        enabled: true,
        subject: 'New {{order.number}}',
        body: 'Body {{order.number}}',
        updatedAt: new Date(),
        lastEditedByEmail: 'a@b.c',
        lastEditedByUserId: 'u1',
        lastEditedAt: new Date(),
      });

    await svc.update(
      'order_paid',
      { subject: 'New {{order.number}}', body: 'Body {{order.number}}' },
      { userId: 'u1', email: 'a@b.c' },
    );

    expect(prisma.emailNotificationTemplateRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventKey: 'order_paid',
          subject: 'Old',
          body: 'Old body',
          actorUserId: 'u1',
          actorEmail: 'a@b.c',
        }),
      }),
    );
    expect(prisma.emailNotificationTemplate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          subject: 'New {{order.number}}',
          lastEditedByEmail: 'a@b.c',
          lastEditedByUserId: 'u1',
        }),
      }),
    );
  });

  it('buildForEvent возвращает null если выключено', async () => {
    prisma.emailNotificationTemplate.findMany.mockResolvedValue([
      { eventKey: 'order_paid' },
    ]);
    prisma.emailNotificationTemplate.findUnique.mockResolvedValue({
      eventKey: 'order_paid',
      enabled: false,
      subject: 'S {{order.number}}',
      body: 'B {{order.number}}',
      updatedAt: new Date(),
    });
    const mail = await svc.buildForEvent('order_paid', {
      'order.number': '1',
    });
    expect(mail).toBeNull();
  });

  it('buildForEvent рендерит включённый шаблон', async () => {
    prisma.emailNotificationTemplate.findMany.mockResolvedValue([
      { eventKey: 'order_paid' },
    ]);
    prisma.emailNotificationTemplate.findUnique.mockResolvedValue({
      eventKey: 'order_paid',
      enabled: true,
      subject: 'Paid {{order.number}}',
      body: 'Order {{order.number}} ok',
      updatedAt: new Date(),
    });
    const mail = await svc.buildForEvent('order_paid', {
      'order.number': 'MF-2',
      'order.url': 'https://shop.test/o',
    });
    expect(mail?.subject).toBe('Paid MF-2');
    expect(mail?.text).toContain('MF-2');
    expect(mail?.html).toContain('MF-2');
  });

  it('buildForEvent кэширует findUnique в пределах TTL', async () => {
    prisma.emailNotificationTemplate.findMany.mockResolvedValue([
      { eventKey: 'order_paid' },
    ]);
    prisma.emailNotificationTemplate.findUnique.mockResolvedValue({
      enabled: true,
      subject: 'S {{order.number}}',
      body: 'B {{order.number}}',
    });
    await svc.buildForEvent('order_paid', { 'order.number': '1' });
    await svc.buildForEvent('order_paid', { 'order.number': '2' });
    expect(prisma.emailNotificationTemplate.findUnique).toHaveBeenCalledTimes(1);
  });

  it('update инвалидирует кэш строки', async () => {
    prisma.emailNotificationTemplate.findMany.mockResolvedValue([
      { eventKey: 'order_paid' },
    ]);
    prisma.emailNotificationTemplate.findUnique
      .mockResolvedValueOnce({
        enabled: true,
        subject: 'Cached {{order.number}}',
        body: 'Cached body',
      })
      .mockResolvedValueOnce({
        eventKey: 'order_paid',
        enabled: true,
        subject: 'Old',
        body: 'Old body',
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        enabled: true,
        subject: 'New {{order.number}}',
        body: 'New body {{order.number}}',
      })
      .mockResolvedValue({
        eventKey: 'order_paid',
        enabled: true,
        subject: 'New {{order.number}}',
        body: 'New body {{order.number}}',
        updatedAt: new Date(),
        lastEditedByEmail: 'a@b.c',
        lastEditedByUserId: 'u1',
        lastEditedAt: new Date(),
      });

    await svc.buildForEvent('order_paid', { 'order.number': '1' });
    await svc.update(
      'order_paid',
      { subject: 'New {{order.number}}', body: 'New body {{order.number}}' },
      { userId: 'u1', email: 'a@b.c' },
    );
    const mail = await svc.buildForEvent('order_paid', { 'order.number': '9' });
    expect(mail?.subject).toBe('New 9');
  });

  it('preview sparse скрывает #if (tracking / pay_url / refund / items)', async () => {
    const { getEmailNotificationEventDef, isEmailNotificationEventKey } =
      await import('./email-notification-events');
    prisma.emailNotificationTemplate.findMany.mockResolvedValue(
      [
        'order_shipped',
        'order_awaiting_payment',
        'order_refund',
        'order_paid',
      ].map((eventKey) => ({ eventKey })),
    );
    prisma.emailNotificationTemplate.findUnique.mockImplementation(
      async ({ where }: { where: { eventKey: string } }) => {
        if (!isEmailNotificationEventKey(where.eventKey)) {
          return null;
        }
        const def = getEmailNotificationEventDef(where.eventKey);
        return {
          eventKey: def.key,
          enabled: true,
          subject: def.defaultSubject,
          body: def.defaultBody,
          updatedAt: new Date(),
        };
      },
    );

    const shippedFull = await svc.preview('order_shipped', {
      sampleVariant: 'full',
    });
    const shippedSparse = await svc.preview('order_shipped', {
      sampleVariant: 'sparse',
    });
    expect(shippedFull.text).toContain('1234567890');
    expect(shippedSparse.text).not.toContain('1234567890');
    expect(shippedSparse.text).not.toContain('Трек-номер');

    const awaitingFull = await svc.preview('order_awaiting_payment', {
      sampleVariant: 'full',
    });
    const awaitingSparse = await svc.preview('order_awaiting_payment', {
      sampleVariant: 'sparse',
    });
    expect(awaitingFull.html).toContain('/order/pay');
    expect(awaitingSparse.html).not.toContain('/order/pay');
    expect(awaitingSparse.html.toLowerCase()).not.toContain('>оплатить<');

    const refundFull = await svc.preview('order_refund', {
      sampleVariant: 'full',
    });
    const refundSparse = await svc.preview('order_refund', {
      sampleVariant: 'sparse',
    });
    expect(refundFull.text).toMatch(/1[\s\u00a0]?200/);
    expect(refundSparse.text).not.toMatch(/Сумма:/);

    const paidFull = await svc.preview('order_paid', { sampleVariant: 'full' });
    const paidSparse = await svc.preview('order_paid', {
      sampleVariant: 'sparse',
    });
    expect(paidFull.text).toContain('Крем');
    expect(paidSparse.text).not.toContain('Крем');
  });
});
