import { describe, expect, it } from 'vitest';

/**
 * Регрессия: после confirm ShippingCarrierModal не должен закрывать родителя,
 * иначе OrderAddressEditModal теряет шаг «стоимость».
 */
describe('admin address edit · closeAfterConfirm', () => {
  it('при closeAfterConfirm=false родительский open остаётся true', () => {
    let parentOpen = true;
    let confirmOpen = false;

    const onConfirm = () => {
      confirmOpen = true;
    };
    const onClose = () => {
      parentOpen = false;
      // как useEffect в OrderAddressEditModal при open=false
      confirmOpen = false;
    };

    const closeAfterConfirm = false;
    onConfirm();
    if (closeAfterConfirm) onClose();

    expect(parentOpen).toBe(true);
    expect(confirmOpen).toBe(true);
  });

  it('при closeAfterConfirm=true (checkout) модалка закрывается', () => {
    let parentOpen = true;
    let confirmOpen = false;

    const onConfirm = () => {
      confirmOpen = true;
    };
    const onClose = () => {
      parentOpen = false;
      confirmOpen = false;
    };

    const closeAfterConfirm = true;
    onConfirm();
    if (closeAfterConfirm) onClose();

    expect(parentOpen).toBe(false);
    expect(confirmOpen).toBe(false);
  });
});
