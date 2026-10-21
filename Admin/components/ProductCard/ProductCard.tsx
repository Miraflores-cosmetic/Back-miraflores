import Link from 'next/link';
import { formatRub, type PublicCardVolumeOption } from '@/lib/publicCatalog';
import { productCartHref } from '@/lib/cart/cartUtils';
import { ProductCardMedia } from './ProductCardMedia';
import styles from './ProductCard.module.css';

export type ProductCardProps = {
  productId?: string | null;
  variantId?: string | null;
  variantName?: string | null;
  shadeId?: string | null;
  shadeName?: string | null;
  slug: string;
  name: string;
  shortDescription?: string | null;
  price: number;
  oldPrice?: number | null;
  discountPercent?: number | null;
  /** Показать «от» перед ценой (диапазон вариантов) */
  priceFrom?: boolean;
  imageUrl?: string | null;
  /** Галерея для scrub при наведении */
  imageUrls?: string[] | null;
  mediaType?: 'image' | 'video' | null;
  minQty?: number | null;
  /** Верхний предел qty (stock ∩ orderMaxQty) */
  maxQty?: number | null;
  available?: number | null;
  /** Все объёмы товара — sizeRow + модалка ATC. */
  variants?: PublicCardVolumeOption[] | null;
};

/** Server-friendly оболочка; scrub/qty — в `ProductCardMedia`. */
export function ProductCard({
  productId,
  variantId,
  variantName,
  shadeId,
  shadeName,
  slug,
  name,
  shortDescription,
  price,
  oldPrice,
  discountPercent,
  priceFrom,
  imageUrl,
  imageUrls,
  mediaType,
  minQty,
  maxQty,
  variants,
}: ProductCardProps) {
  const href = productCartHref(slug, variantId, shadeId);
  const volumeLabels = (variants ?? [])
    .map((v) => v.name?.trim())
    .filter((n): n is string => Boolean(n));
  const volumeSubtitle =
    volumeLabels.length <= 3
      ? volumeLabels.join(' · ')
      : `${volumeLabels.slice(0, 3).join(' · ')} · +${volumeLabels.length - 3}`;

  return (
    <article className={styles.productCard}>
      <ProductCardMedia
        productId={productId}
        variantId={variantId}
        variantName={variantName}
        shadeId={shadeId}
        shadeName={shadeName}
        slug={slug}
        name={name}
        price={price}
        oldPrice={oldPrice}
        discountPercent={discountPercent}
        imageUrl={imageUrl}
        imageUrls={imageUrls}
        mediaType={mediaType}
        minQty={minQty}
        maxQty={maxQty}
        variants={variants}
      />

      <Link href={href} className={styles.productTitles}>
        <span className={styles.productName}>{name}</span>
        {volumeSubtitle ? (
          <span className={styles.productVolumes}>{volumeSubtitle}</span>
        ) : null}
        {shortDescription ? (
          <span className={styles.productShort}>{shortDescription}</span>
        ) : null}
        <span className={styles.productPriceRow}>
          <span className={styles.productPrice}>
            {priceFrom ? 'от ' : ''}
            {formatRub(price)}
          </span>
          {oldPrice != null && oldPrice > price ? (
            <span className={styles.productOldPrice}>{formatRub(oldPrice)}</span>
          ) : null}
        </span>
      </Link>
    </article>
  );
}
