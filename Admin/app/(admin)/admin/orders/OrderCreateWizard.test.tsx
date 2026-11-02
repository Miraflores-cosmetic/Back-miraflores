/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const clearDraft = vi.fn();
const saveDraft = vi.fn();
let draftOnLoad: unknown = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('./orderCreate/draftStorage', () => ({
  loadOrderCreateDraft: () => draftOnLoad,
  saveOrderCreateDraft: (...args: unknown[]) => saveDraft(...args),
  clearOrderCreateDraft: () => clearDraft(),
}));

vi.mock('@/lib/adminBackendFetch', () => ({
  AdminBackendRequestError: class extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
  adminBackendJson: vi.fn(),
}));

vi.mock('@/app/(admin)/admin/settings/gratitude/VariantPickerModal', () => ({
  VariantPickerModal: () => null,
}));

vi.mock('./orderCreate/GiftDenomPickerModal', () => ({
  GiftDenomPickerModal: () => null,
}));

vi.mock('@/components/shipping/ShippingCarrierModal', () => ({
  ShippingCarrierModal: () => null,
}));

vi.mock('./orderCreate/UserPickerModal', () => ({
  UserPickerModal: () => null,
}));

import { adminBackendJson } from '@/lib/adminBackendFetch';
import { OrderCreateWizard } from './OrderCreateWizard';
import type { OrderCreateDraftV1 } from './orderCreate/draftStorage';

const backendJson = vi.mocked(adminBackendJson);

function completeDraft(
  over: Partial<OrderCreateDraftV1> = {},
): OrderCreateDraftV1 {
  return {
    v: 1,
    savedAt: Date.now(),
    step: 5,
    clientMode: 'guest',
    userId: null,
    userLabelText: '',
    email: 'a@b.com',
    phone: '+79991234567',
    customerName: 'Иван',
    customerNote: '',
    lines: [
      {
        key: 'k1',
        variantId: 'v1',
        shadeId: null,
        shadeName: null,
        title: 'Товар',
        sku: 'SKU',
        catalogPrice: 1000,
        unitPrice: 1000,
        qty: 1,
      },
    ],
    attachGratitude: false,
    promoCode: '',
    giftCertificateCode: '',
    shipping: {
      selection: { dropoff: 'courier' } as never,
      shippingCost: 100,
      shippingMethod: 'CDEK',
      address: {
        city: 'Москва',
        address: 'Тверская 1',
        apartment: '',
        region: '',
        district: '',
        postalCode: '',
        phone: '',
        recipientName: '',
        pvzCode: '',
        comment: 'x',
      },
    },
    payMode: 'awaiting_link',
    notifyCustomer: true,
    refHash: '',
    extUserId: '',
    idempotencyKey: 'admin-wizard-test-key-01',
    ...over,
  };
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  vi.clearAllMocks();
  draftOnLoad = null;
});

beforeEach(() => {
  backendJson.mockImplementation(async (path: string) => {
    if (String(path).includes('preview')) {
      return {
        subtotal: 1000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        shippingCost: 100,
        total: 1100,
        promoCode: null,
        giftCertificateCode: null,
        gratitudeCount: 0,
        priceOverrides: [],
        lines: [],
      };
    }
    return {
      order: { id: 'o1', number: 'N-1' },
      paymentLink: null,
      paymentError: null,
    };
  });
});

describe('OrderCreateWizard dialogs', () => {
  it('cancel «Да, к списку» чистит draft', async () => {
    draftOnLoad = null;
    render(<OrderCreateWizard />);
    fireEvent.change(screen.getByLabelText(/имя/i), {
      target: { value: 'Иван' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.getByRole('heading', { name: 'Отменить создание?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Да, к списку' }));
    expect(clearDraft).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/admin/orders');
  });

  it('awaiting_link без URL → follow-up warning, не silent redirect', async () => {
    draftOnLoad = completeDraft({ payMode: 'awaiting_link' });
    backendJson.mockImplementation(async (path: string) => {
      if (String(path).includes('preview')) {
        return {
          subtotal: 1000,
          discountTotal: 0,
          giftCertificateAmount: 0,
          shippingCost: 100,
          total: 1100,
          promoCode: null,
          giftCertificateCode: null,
          gratitudeCount: 0,
          priceOverrides: [],
          lines: [],
        };
      }
      return {
        order: { id: 'o1', number: 'N-1' },
        paymentLink: null,
        paymentError: null,
      };
    });

    render(<OrderCreateWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Создать заказ' })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Создать заказ' }));
    await waitFor(() =>
      expect(screen.getByText(/Платёжная ссылка не создана/i)).toBeTruthy(),
    );
    expect(push).not.toHaveBeenCalledWith('/admin/orders/o1');
  });

  it('payment link dialog: Открыть + К заказу', async () => {
    draftOnLoad = completeDraft({ payMode: 'awaiting_link' });
    backendJson.mockImplementation(async (path: string) => {
      if (String(path).includes('preview')) {
        return {
          subtotal: 1000,
          discountTotal: 0,
          giftCertificateAmount: 0,
          shippingCost: 100,
          total: 1100,
          promoCode: null,
          giftCertificateCode: null,
          gratitudeCount: 0,
          priceOverrides: [],
          lines: [],
        };
      }
      return {
        order: { id: 'o1', number: 'N-1' },
        paymentLink: 'https://pay.example/link',
        paymentError: null,
      };
    });

    render(<OrderCreateWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Создать заказ' })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Создать заказ' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Ссылка на оплату' })).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Открыть' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'К заказу' }));
    expect(push).toHaveBeenCalledWith('/admin/orders/o1');
  });
});
