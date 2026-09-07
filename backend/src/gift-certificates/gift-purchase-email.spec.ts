import { describe, expect, it } from 'vitest';
import {
  giftCertificateIssuedEmail,
  giftPurchasePaidEmail,
  maskGiftCertificateCode,
} from './gift-purchase-email';

describe('giftPurchasePaidEmail', () => {
  it('отправляет код получателю с номиналом по каждому item', () => {
    const mail = giftPurchasePaidEmail({
      orderNumber: 'JCOS-1',
      items: [
        { code: 'JC-AAAA-BBBB-CCCC', faceValue: 3000, expiresAt: null },
        { code: 'JC-DDDD-EEEE-FFFF', faceValue: 5000, expiresAt: null },
      ],
      recipientEmail: 'gift@ex.com',
      buyerEmail: 'buyer@ex.com',
    });
    expect(mail.to).toBe('gift@ex.com');
    expect(mail.text).toContain('JC-AAAA-BBBB-CCCC');
    expect(mail.text).toContain('3\u00a0000');
    expect(mail.text).toContain('JC-DDDD-EEEE-FFFF');
    expect(mail.text).toContain('5\u00a0000');
    expect(mail.subject).toContain('JCOS-1');
    expect(mail.html).toContain('Miraflores');
  });
});

describe('giftCertificateIssuedEmail', () => {
  it('письмо выпуска / resend', () => {
    const mail = giftCertificateIssuedEmail({
      items: [{ code: 'JC-AAAA-BBBB-CCCC', faceValue: 1000, expiresAt: null }],
      to: 'a@b.co',
      resend: true,
    });
    expect(mail.to).toBe('a@b.co');
    expect(mail.subject).toContain('Повторная');
    expect(mail.html).toContain('JC-AAAA-BBBB-CCCC');
    expect(mail.html).toContain('Miraflores');
  });
});

describe('maskGiftCertificateCode', () => {
  it('маскирует хвост', () => {
    expect(maskGiftCertificateCode('JC-AAAA-BBBB-CCCC')).toBe('JC-AAAA-****-****');
  });
});
