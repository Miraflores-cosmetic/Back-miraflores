import { describe, expect, it } from 'vitest';
import { buildAdminChatNotifyEmail } from './admin-chat-notify';

describe('buildAdminChatNotifyEmail', () => {
  it('includes message text for order chat', () => {
    const built = buildAdminChatNotifyEmail({
      kind: 'order',
      messageText: 'Когда доставка?',
      customerName: 'Иван',
      customerEmail: 'a@b.co',
      orderNumber: '000027',
      adminChatUrl: 'https://admin.example/admin/orders/o1#order-chat',
      siteUrl: 'https://shop.example',
    });
    expect(built.subject).toContain('000027');
    expect(built.text).toContain('Когда доставка?');
    expect(built.html).toContain('Когда доставка?');
    expect(built.html).toContain('Открыть чат в админке');
  });

  it('includes message text for support chat', () => {
    const built = buildAdminChatNotifyEmail({
      kind: 'support',
      messageText: 'Нужна помощь с сертификатом',
      customerEmail: 'u@x.co',
      adminChatUrl: 'https://admin.example/admin/orders/chat?user=u1',
    });
    expect(built.subject).toContain('поддержки');
    expect(built.text).toContain('Нужна помощь с сертификатом');
  });
});
