import {
  type CampaignIn,
  priceCartLines,
} from '../discounts/discount-pricing.engine';

export type CatalogCampaignCard = {
  id: string;
  categoryId: string;
  price: number;
  oldPrice: number | null;
  discountPercent: number | null;
};

export type CatalogCampaignVariant = {
  id: string;
  price: number;
  compareAt: number | null;
};

/** Кампании (qty=1) на карточку — отдельно, как одна позиция в корзине. */
export function applyCampaignToCards<T extends CatalogCampaignCard>(
  cards: T[],
  campaigns: CampaignIn[],
): T[] {
  if (!campaigns.length || !cards.length) return cards;
  return cards.map((card) => {
    const priced = priceCartLines(
      [
        {
          key: card.id,
          productId: card.id,
          categoryId: card.categoryId,
          qty: 1,
          listPrice: card.price,
        },
      ],
      campaigns,
    );
    const line = priced.lines[0];
    if (!line || line.lineDiscount <= 0 || line.price >= card.price) return card;
    const listPrice = card.price;
    const salePrice = line.price;
    const oldPrice = Math.max(card.oldPrice ?? listPrice, listPrice);
    return {
      ...card,
      price: salePrice,
      oldPrice,
      discountPercent: Math.round(((oldPrice - salePrice) / oldPrice) * 100),
    };
  });
}

/**
 * Те же кампании, что на карточках — для PDP-вариантов.
 * Каждый вариант считается отдельно (qty=1), иначе PERCENT аллоцируется
 * между вариантами одного товара и даёт ±1 ₽ относительно карточки.
 */
export function applyCampaignToDetailVariants<T extends CatalogCampaignVariant>(
  variants: T[],
  productId: string,
  categoryId: string,
  campaigns: CampaignIn[],
): T[] {
  if (!campaigns.length || !variants.length) return variants;
  return variants.map((v) => {
    const priced = priceCartLines(
      [
        {
          key: v.id,
          productId,
          categoryId,
          qty: 1,
          listPrice: v.price,
        },
      ],
      campaigns,
    );
    const line = priced.lines[0];
    if (!line || line.lineDiscount <= 0 || line.price >= v.price) return v;
    const listPrice = v.price;
    const salePrice = line.price;
    const compareAt = Math.max(v.compareAt ?? listPrice, listPrice);
    return {
      ...v,
      price: salePrice,
      compareAt: compareAt > salePrice ? compareAt : null,
    };
  });
}
