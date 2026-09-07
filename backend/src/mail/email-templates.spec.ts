import { describe, expect, it } from 'vitest';
import {
  buildGiftCertificateIssuedEmail,
  buildGiftPurchasePaidEmail,
  buildOrderCancelledEmail,
  buildOrderDeliveredEmail,
  buildOrderPaidEmail,
  buildOrderRefundEmail,
  buildOrderShippedEmail,
  buildPasswordResetEmail,
  buildRegistrationOtpEmail,
  buildStaffAdminPasswordResetEmail,
  buildStaffAdminWelcomeEmail,
} from './email-templates';

describe('email templates', () => {
  it('registration OTP includes code and Miraflores layout', () => {
    const e = buildRegistrationOtpEmail({ code: '123456', siteUrl: 'http://localhost:5173' });
    expect(e.subject).toContain('Miraflores');
    expect(e.text).toContain('123456');
    expect(e.html).toContain('123456');
    expect(e.html).toContain('Miraflores');
    expect(e.html).not.toContain('Jcos');
  });

  it('password reset has CTA link', () => {
    const link = 'http://localhost:5173/reset-password?token=abc';
    const e = buildPasswordResetEmail({ resetLink: link, siteUrl: 'http://localhost:5173' });
    expect(e.html).toContain(link);
    expect(e.html).toContain('Задать пароль');
    expect(e.subject).toContain('пароль');
  });

  it('order paid shows number and account CTA', () => {
    const e = buildOrderPaidEmail({
      orderNumber: 'MF-100',
      siteUrl: 'http://localhost:5173',
    });
    expect(e.subject).toContain('MF-100');
    expect(e.html).toContain('/profile?tab=orders');
    expect(e.html).toContain('MF-100');
    expect(e.html).toContain('/profile');
    expect(e.html).not.toContain('Jcos');
  });

  it('order shipped / delivered / cancelled / refund', () => {
    expect(buildOrderShippedEmail({ orderNumber: 'A1', tracking: 'TRK' }).html).toContain('TRK');
    expect(buildOrderDeliveredEmail({ orderNumber: 'A1' }).subject).toContain('доставлен');
    expect(buildOrderCancelledEmail({ orderNumber: 'A1' }).subject).toContain('отменён');
    expect(
      buildOrderRefundEmail({ orderNumber: 'A1', amount: 1500, full: true }).text,
    ).toMatch(/1[\s\u00a0]?500/);
    expect(
      buildOrderRefundEmail({ orderNumber: 'A1', amount: 100, kind: 'late' }).html,
    ).toContain('истёк');
  });

  it('gift + staff templates use layout', () => {
    const gift = buildGiftPurchasePaidEmail({
      orderNumber: 'G1',
      items: [
        { code: 'CODE-1', faceValue: 3000, expiresAt: null },
        { code: 'CODE-2', faceValue: 1500, expiresAt: null },
      ],
    });
    expect(gift.html).toContain('CODE-1');
    expect(gift.html).toContain('CODE-2');
    expect(gift.text).toContain('1\u00a0500');
    expect(gift.html).toContain('Miraflores');

    const issued = buildGiftCertificateIssuedEmail({
      items: [{ code: 'CODE-2', faceValue: 1000, expiresAt: null }],
      resend: true,
    });
    expect(issued.subject).toContain('Повторная');

    const welcome = buildStaffAdminWelcomeEmail({
      to: 'a@b.co',
      password: 'tmp-pass',
      loginUrl: 'http://localhost:3010/admin/login',
    });
    expect(welcome.html).toContain('tmp-pass');
    expect(welcome.html).toContain('Войти в админку');

    const reset = buildStaffAdminPasswordResetEmail({
      to: 'a@b.co',
      password: 'new-pass',
      loginUrl: 'http://localhost:3010/admin/login',
    });
    expect(reset.html).toContain('new-pass');
  });
});
