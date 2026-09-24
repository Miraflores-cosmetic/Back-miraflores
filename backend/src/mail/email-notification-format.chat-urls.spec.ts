import { describe, expect, it } from 'vitest';
import {
  accountOrderChatUrl,
  accountSupportChatUrl,
} from './email-notification-format';

describe('account chat deep links', () => {
  it('order chat includes chatOrder query', () => {
    expect(accountOrderChatUrl('https://miraflores-shop.com', 'ord-1')).toBe(
      'https://miraflores-shop.com/profile?tab=orders&chatOrder=ord-1',
    );
  });

  it('support chat includes chatSupport flag', () => {
    expect(accountSupportChatUrl('https://miraflores-shop.com/')).toBe(
      'https://miraflores-shop.com/profile?chatSupport=1',
    );
  });
});
