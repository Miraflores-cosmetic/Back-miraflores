/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderItemsEditModal } from './OrderItemsEditModal';
import type { AdminOrderItem } from '@/lib/adminOrderTypes';

vi.mock('@/app/(admin)/admin/settings/gratitude/VariantPickerModal', () => ({
  VariantPickerModal: ({
    open,
    onApply,
  }: {
    open: boolean;
    onApply: (
      variantId: string,
      label: string,
      details?: {
        sku: string;
        price: number;
        title: string;
        shadeId: string | null;
        shadeName: string | null;
      },
    ) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onApply('v-shade', 'Serum · Нюд', {
            sku: 'SKU-S',
            price: 1200,
            title: 'Serum · Нюд',
            shadeId: 'sh1',
            shadeName: 'Нюд',
          })
        }
      >
        mock-apply-shade
      </button>
    ) : null,
}));

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

const pricing = {
  discountTotal: 100,
  giftCertificateAmount: 0,
  shippingCost: 200,
  netPaid: 1100,
  currentTotal: 1100,
  promoCode: 'SALE10',
};

function item(over: Partial<AdminOrderItem> = {}): AdminOrderItem {
  return {
    id: 'i1',
    variantId: 'v1',
    shadeId: null,
    shadeName: null,
    title: 'Serum',
    sku: 'SKU-1',
    qty: 1,
    unitPrice: 1000,
    lineTotal: 1000,
    isGratitudeGift: false,
    ...over,
  };
}

function openConfirmWithTenPercent(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <OrderItemsEditModal
      open
      initialItems={[item()]}
      busy={false}
      hasPromoOrGift
      pricing={pricing}
      onClose={() => {}}
      onSave={onSave}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Скидка 10% · Serum' }));
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  return { onSave, dialog: screen.getByRole('alertdialog') };
}

describe('OrderItemsEditModal', () => {
  it('−10% preset → confirm → payload с уценкой и notify', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { dialog } = openConfirmWithTenPercent(onSave);
    expect(
      within(dialog).getByRole('heading', {
        name: 'Подтвердить изменение суммы',
      }),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      notifyCustomer: true,
      items: [
        expect.objectContaining({
          variantId: 'v1',
          qty: 1,
          unitPrice: 900,
          title: 'Serum',
          sku: 'SKU-1',
        }),
      ],
    });
  });

  it('Enter в своём % применяет скидку на строку', () => {
    render(
      <OrderItemsEditModal
        open
        initialItems={[item()]}
        busy={false}
        pricing={{ ...pricing, discountTotal: 0, promoCode: null }}
        onClose={() => {}}
        onSave={async () => {}}
      />,
    );

    const pctField = screen.getByRole('textbox', {
      name: 'Своя скидка в процентах · Serum',
    });
    fireEvent.change(pctField, { target: { value: '20' } });
    fireEvent.keyDown(pctField, { key: 'Enter' });

    expect(
      screen.getByRole('button', { name: 'Скидка 20% · Serum' }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
    expect(screen.getByText(/Было/).textContent).toMatch(/800/);
  });

  it('Enter в bulk % применяет скидку на все', () => {
    render(
      <OrderItemsEditModal
        open
        initialItems={[
          item({ id: 'a', title: 'A', unitPrice: 1000, lineTotal: 1000 }),
          item({ id: 'b', title: 'B', unitPrice: 500, lineTotal: 500 }),
        ]}
        busy={false}
        pricing={{ ...pricing, discountTotal: 0, promoCode: null }}
        onClose={() => {}}
        onSave={async () => {}}
      />,
    );

    const bulk = screen.getByRole('textbox', {
      name: 'Своя скидка в процентах на все позиции',
    });
    fireEvent.change(bulk, { target: { value: '10' } });
    fireEvent.keyDown(bulk, { key: 'Enter' });

    expect(
      screen.getByRole('button', { name: 'Скидка 10% на все позиции' }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
  });

  it('ошибка save: confirm остаётся, ошибка видна, повторный Сохранить', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error('Склад: нет остатка'))
      .mockResolvedValueOnce(undefined);

    const { dialog } = openConfirmWithTenPercent(onSave);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toMatch(
        /нет остатка/i,
      ),
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).toBeNull(),
    );
  });

  it('под confirm Cancel/X родителя disabled', () => {
    openConfirmWithTenPercent();
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    const parentCancel = screen
      .getAllByRole('button', { name: 'Отмена' })
      .find((b) => !b.closest('[role="alertdialog"]'));
    expect(parentCancel?.hasAttribute('disabled')).toBe(true);
    const parentClose = screen
      .getAllByRole('button', { name: 'Закрыть' })
      .find((b) => !b.closest('[role="alertdialog"]'));
    expect(parentClose?.hasAttribute('disabled')).toBe(true);
  });

  it('cancel под confirm только закрывает диалог, модалка остаётся', () => {
    const onClose = vi.fn();
    render(
      <OrderItemsEditModal
        open
        initialItems={[item()]}
        busy={false}
        pricing={pricing}
        onClose={onClose}
        onSave={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Скидка 10% · Serum' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Изменить состав' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('blur qty/price: пустой draft → 1 / 0', () => {
    render(
      <OrderItemsEditModal
        open
        initialItems={[item()]}
        busy={false}
        pricing={{ ...pricing, discountTotal: 0, promoCode: null }}
        onClose={() => {}}
        onSave={async () => {}}
      />,
    );

    const qty = screen.getByRole('textbox', {
      name: 'Количество · Serum',
    }) as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '' } });
    fireEvent.blur(qty);
    expect(qty.value).toBe('1');

    const price = screen.getByRole('textbox', {
      name: 'Цена · Serum',
    }) as HTMLInputElement;
    fireEvent.change(price, { target: { value: '' } });
    fireEvent.blur(price);
    expect(price.value).toBe('0');
  });

  it('gift: цена disabled; dual-warn без жаргона clamp', () => {
    render(
      <OrderItemsEditModal
        open
        initialItems={[
          item({ id: 'paid', title: 'Cream', unitPrice: 2000, lineTotal: 2000 }),
          item({
            id: 'gift',
            title: 'Gift',
            unitPrice: 0,
            lineTotal: 0,
            isGratitudeGift: true,
          }),
        ]}
        busy={false}
        hasPromoOrGift
        pricing={pricing}
        onClose={() => {}}
        onSave={async () => {}}
      />,
    );

    expect(
      (screen.getByRole('textbox', { name: 'Цена · Gift' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Скидка 10% · Cream' }));
    const warn = screen.getByRole('status').textContent ?? '';
    expect(warn).toMatch(/промокод/i);
    expect(warn).not.toMatch(/clamp|freeze|unitPrice/i);
  });

  it('add from catalog передаёт shadeId в save payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <OrderItemsEditModal
        open
        initialItems={[]}
        busy={false}
        hasPromoOrGift={false}
        pricing={{
          discountTotal: 0,
          giftCertificateAmount: 0,
          shippingCost: 0,
          netPaid: 0,
          currentTotal: 0,
          promoCode: null,
        }}
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Добавить из каталога' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'mock-apply-shade' }));
    expect(screen.getByText(/Оттенок:\s*Нюд/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            variantId: 'v-shade',
            shadeId: 'sh1',
            unitPrice: 1200,
          }),
        ],
      }),
    );
  });

  it('превью: промо без слова clamp', () => {
    render(
      <OrderItemsEditModal
        open
        initialItems={[item({ unitPrice: 400, lineTotal: 400 })]}
        busy={false}
        hasPromoOrGift
        pricing={{
          discountTotal: 500,
          giftCertificateAmount: 0,
          shippingCost: 100,
          netPaid: 0,
          currentTotal: 100,
          promoCode: 'BIG',
        }}
        onClose={() => {}}
        onSave={async () => {}}
      />,
    );

    const previewRoot = screen.getByText('Товары').parentElement?.parentElement;
    expect(previewRoot?.textContent).toMatch(/Промо/);
    expect(previewRoot?.textContent).toMatch(/по составу/);
    expect(previewRoot?.textContent).not.toMatch(/clamp/i);
  });
});
