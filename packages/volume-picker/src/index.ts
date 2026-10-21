/**
 * Общий контракт VolumePicker для Front и Admin storefront.
 * UI остаётся локальным (разные CSS / motion), данные — одинаковые.
 */
export type VolumePickerOption = {
  id: string;
  /** Подпись объёма («50 мл»). */
  label: string;
  price: number;
  oldPrice?: number | null;
  /** Остаток; вместе с trackInventory — OOS. */
  quantityAvailable?: number | null;
  trackInventory?: boolean | null;
  /** orderMinQty / orderMaxQty — для ATC с карточки. */
  minQty?: number;
  maxQty?: number;
};

export function isVolumeOptionOutOfStock(opt: VolumePickerOption): boolean {
  if (opt.maxQty != null && opt.minQty != null && opt.maxQty < opt.minQty) {
    return true;
  }
  if (opt.trackInventory === false) return false;
  if (opt.quantityAvailable == null) return false;
  return opt.quantityAvailable <= 0;
}

/** Admin PublicCardVolumeOption → общий контракт. */
export function volumeOptionFromCardVariant(v: {
  id: string;
  name: string;
  price: number;
  oldPrice?: number | null;
  available: number;
  minQty: number;
  maxQty: number;
}): VolumePickerOption {
  return {
    id: v.id,
    label: v.name,
    price: v.price,
    oldPrice: v.oldPrice,
    quantityAvailable: v.available,
    trackInventory: true,
    minQty: v.minQty,
    maxQty: v.maxQty,
  };
}
