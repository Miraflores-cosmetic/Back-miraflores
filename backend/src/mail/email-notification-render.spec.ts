import { describe, expect, it } from 'vitest';
import {
  extractIfConditionKeys,
  extractTemplatePlaceholders,
  interpolateTemplate,
  plainBodyToHtml,
  renderEditableEmail,
} from './email-notification-render';
import {
  EMAIL_NOTIFICATION_EVENT_KEYS,
  EMAIL_NOTIFICATION_EVENTS,
  isEmailNotificationEventKey,
} from './email-notification-events';

describe('email-notification-render', () => {
  it('подставляет {{vars}} и экранирует HTML', () => {
    const out = interpolateTemplate(
      'Заказ {{order.number}} — {{order.note}}',
      { 'order.number': 'MF-1', 'order.note': '<b>x</b>' },
      { escape: true },
    );
    expect(out).toBe('Заказ MF-1 — &lt;b&gt;x&lt;/b&gt;');
  });

  it('пустой плейсхолдер → пустая строка', () => {
    expect(
      interpolateTemplate('Hi {{missing}}!', {}, { escape: false }),
    ).toBe('Hi !');
  });

  it('plainBodyToHtml бьёт на абзацы', () => {
    const html = plainBodyToHtml('A\nB\n\nC');
    expect(html).toContain('A<br/>\nB');
    expect(html).toContain('>C</p>');
  });

  it('renderEditableEmail собирает subject/text/html с layout', () => {
    const mail = renderEditableEmail({
      subjectTemplate: 'Заказ {{order.number}} — {{site.name}}',
      bodyTemplate: 'Номер {{order.number}}\n\nСсылка: {{order.url}}',
      vars: {
        'order.number': 'MF-9',
        'order.url': 'https://example.com/o/1',
      },
      siteUrl: 'https://example.com',
    });
    expect(mail.subject).toContain('MF-9');
    expect(mail.subject).toContain('Miraflores');
    expect(mail.text).toContain('MF-9');
    expect(mail.html).toContain('Miraflores');
    expect(mail.html).toContain('MF-9');
    expect(mail.html).not.toContain('{{');
  });

  it('сниппеты cta/block дают кнопку и карточку', () => {
    const mail = renderEditableEmail({
      subjectTemplate: 'Pay {{order.number}}',
      bodyTemplate: '{{block.order_card}}\n\n{{cta.pay}}',
      vars: {
        'order.number': 'MF-1',
        'order.total_label': '1 000 ₽',
        'order.pay_url': 'https://shop.test/order/pay?orderId=1&payToken=t',
      },
      siteUrl: 'https://shop.test',
    });
    expect(mail.html).toContain('Номер заказа');
    expect(mail.html).toContain('MF-1');
    expect(mail.html).toContain('Оплатить');
    expect(mail.html).toContain('https://shop.test/order/pay');
    expect(mail.text).toContain('Заказ MF-1');
  });

  it('{{#if order.tracking}} скрывает пустой трек', () => {
    const tpl =
      'Отправлен.\n\n{{#if order.tracking}}\nТрек: {{order.tracking}}\n{{/if}}\n\nКонец';
    const withTrack = renderEditableEmail({
      subjectTemplate: 'S',
      bodyTemplate: tpl,
      vars: { 'order.tracking': 'ABC' },
      siteUrl: 'https://shop.test',
    });
    expect(withTrack.text).toContain('Трек: ABC');
    const noTrack = renderEditableEmail({
      subjectTemplate: 'S',
      bodyTemplate: tpl,
      vars: { 'order.tracking': '' },
      siteUrl: 'https://shop.test',
    });
    expect(noTrack.text).not.toContain('Трек:');
    expect(noTrack.text).toContain('Конец');
  });

  it('order.items_html инжектится без escape оболочки', () => {
    const mail = renderEditableEmail({
      subjectTemplate: 'S',
      bodyTemplate: '{{order.items_html}}',
      vars: {
        'order.items_html':
          '<table><tr><td>Крем</td></tr></table>',
        'order.items_text': '• Крем',
      },
      siteUrl: 'https://shop.test',
    });
    expect(mail.html).toContain('<table><tr><td>Крем</td></tr></table>');
  });

  it('одиночный URL pay_url → auto CTA', () => {
    const pay = 'https://shop.test/order/pay?x=1';
    const mail = renderEditableEmail({
      subjectTemplate: 'X',
      bodyTemplate: `Оплатите\n\n${pay}`,
      vars: { 'order.pay_url': pay },
      siteUrl: 'https://shop.test',
    });
    expect(mail.html).toContain('Оплатить');
    expect(mail.html).toContain(pay);
  });

  it('extractTemplatePlaceholders', () => {
    expect(
      extractTemplatePlaceholders('{{a.b}} and {{c}}', 'also {{a.b}}'),
    ).toEqual(['a.b', 'c']);
  });

  it('extractIfConditionKeys', () => {
    expect(
      extractIfConditionKeys(
        '{{#if order.tracking}}x{{/if}}',
        '{{#if gift.items_text}}y{{/if}}',
      ),
    ).toEqual(['gift.items_text', 'order.tracking']);
  });
});

describe('baseOrderVars pay_url', () => {
  it('не подставляет profile вместо оплаты', async () => {
    const { baseOrderVars } = await import('./email-notification-format');
    const v = baseOrderVars({
      orderNumber: 'MF-1',
      siteUrl: 'https://shop.test',
    });
    expect(v['order.pay_url']).toBe('');
    expect(v['order.url']).toBe('https://shop.test/profile?tab=orders');
  });
});

describe('email-notification-events', () => {
  it('реестр покрывает все ключи без дублей', () => {
    const keys = EMAIL_NOTIFICATION_EVENTS.map((e) => e.key);
    expect(keys).toEqual([...EMAIL_NOTIFICATION_EVENT_KEYS]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('isEmailNotificationEventKey', () => {
    expect(isEmailNotificationEventKey('order_paid')).toBe(true);
    expect(isEmailNotificationEventKey('nope')).toBe(false);
  });

  it('defaults содержат только известные переменные события (+ site.* / snippets)', () => {
    for (const def of EMAIL_NOTIFICATION_EVENTS) {
      const allowed = new Set(def.variables.map((v) => v.key));
      allowed.add('site.url');
      allowed.add('site.name');
      const used = extractTemplatePlaceholders(def.defaultSubject, def.defaultBody);
      for (const k of used) {
        expect(allowed.has(k), `${def.key}: {{${k}}}`).toBe(true);
      }
    }
  });
});
