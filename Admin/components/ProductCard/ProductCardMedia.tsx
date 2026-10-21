'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FavoriteButton } from '@/components/FavoriteButton/FavoriteButton';
import { VolumePickerModal } from '@/components/VolumePickerModal/VolumePickerModal';
import { productCartHref } from '@/lib/cart/cartUtils';
import { useCart } from '@/lib/cart/CartContext';
import type { PublicCardVolumeOption } from '@/lib/publicCatalog';
import {
  volumeOptionFromCardVariant,
  type VolumePickerOption,
} from '@miraflores/volume-picker';
import styles from './ProductCard.module.css';

export type ProductCardMediaProps = {
  productId?: string | null;
  variantId?: string | null;
  variantName?: string | null;
  shadeId?: string | null;
  shadeName?: string | null;
  slug: string;
  name: string;
  price: number;
  oldPrice?: number | null;
  discountPercent?: number | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  mediaType?: 'image' | 'video' | null;
  minQty?: number | null;
  /** Верхний предел qty (stock ∩ orderMaxQty); 0 = нельзя купить */
  maxQty?: number | null;
  variants?: PublicCardVolumeOption[] | null;
};

function isVideoUrl(url: string, mediaType?: string | null): boolean {
  if (mediaType === 'video') return true;
  return /\.(mp4|mov)(\?|$)/i.test(url);
}

function ProductCardVideo({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      el.removeAttribute('autoplay');
      el.pause();
      return;
    }
    el.muted = true;
    const play = el.play();
    if (play && typeof play.catch === 'function') {
      play.catch(() => {
        /* autoplay blocked */
      });
    }
  }, [url]);

  return (
    <video
      ref={ref}
      className={styles.productImg}
      src={url}
      muted
      loop
      playsInline
      preload="metadata"
      controls={false}
      autoPlay
      aria-hidden
    />
  );
}

function CartBagIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M7.70002 5.95834H14.3C17.4167 5.95834 17.7284 7.41583 17.9392 9.19417L18.7642 16.0692C19.03 18.3242 18.3334 20.1667 15.125 20.1667H6.88419C3.66669 20.1667 2.97002 18.3242 3.24502 16.0692L4.07003 9.19417C4.2717 7.41583 4.58336 5.95834 7.70002 5.95834Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.33325 7.33334V4.125C7.33325 2.75 8.24992 1.83334 9.62492 1.83334H12.3749C13.7499 1.83334 14.6666 2.75 14.6666 4.125V7.33334"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.7091 15.6108H7.33325"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Client-остров: scrub галереи + add/qty корзины. */
export function ProductCardMedia({
  productId,
  variantId,
  variantName,
  shadeId,
  shadeName,
  slug,
  name,
  price,
  oldPrice,
  discountPercent,
  imageUrl,
  imageUrls,
  mediaType,
  minQty: minQtyProp,
  maxQty: maxQtyProp,
  variants: variantsProp,
}: ProductCardMediaProps) {
  const cart = useCart();
  const urls = useMemo(() => {
    const fromGallery = (imageUrls ?? []).filter(Boolean);
    if (fromGallery.length > 0) return fromGallery;
    return imageUrl ? [imageUrl] : [];
  }, [imageUrl, imageUrls]);

  const volumeOptions = useMemo((): VolumePickerOption[] => {
    const list = variantsProp ?? [];
    return list.filter((v) => v.price > 0).map(volumeOptionFromCardVariant);
  }, [variantsProp]);
  const needsVolumePick = volumeOptions.length > 1;

  const [index, setIndex] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [volumeModalOpen, setVolumeModalOpen] = useState(false);
  const scrubMovedRef = useRef(false);
  const urlsKey = urls.join('\0');
  const resolvedVariantId = variantId?.trim() || null;
  const resolvedProductId = productId?.trim() || null;
  const resolvedShadeId = shadeId?.trim() || null;
  const href = productCartHref(slug, resolvedVariantId, resolvedShadeId);
  const minQty = Math.max(1, Math.floor(minQtyProp ?? 1));
  const maxQty = Math.max(0, maxQtyProp ?? 0);
  const canCart = Boolean(
    resolvedProductId &&
      (needsVolumePick
        ? volumeOptions.some(
            (v) => (v.maxQty ?? 0) >= Math.max(1, v.minQty ?? 1),
          )
        : resolvedVariantId && maxQty >= minQty),
  );
  const qty =
    canCart && resolvedVariantId && !needsVolumePick
      ? cart.getQty(resolvedVariantId, resolvedShadeId)
      : 0;
  const lineKey =
    canCart && resolvedVariantId && !needsVolumePick
      ? cart.lineKey(resolvedVariantId, resolvedShadeId)
      : '';

  useEffect(() => {
    setIndex(0);
    setScrubbing(false);
  }, [urlsKey]);

  useEffect(() => {
    if (!canCart || !lineKey) return;
    if (qty > maxQty) cart.setQty(lineKey, maxQty);
  }, [canCart, cart, lineKey, maxQty, qty]);

  const currentUrl = urls[index] ?? null;
  const gallery = urls.length > 1;
  const video = Boolean(currentUrl && isVideoUrl(currentUrl, index === 0 ? mediaType : null));

  const scrubFromClientX = useCallback(
    (clientX: number, el: HTMLElement) => {
      if (urls.length <= 1) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const next = Math.min(urls.length - 1, Math.floor(ratio * urls.length));
      setIndex(next);
    },
    [urls.length],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!gallery) return;
      // Mouse: hover scrub. Touch/pen: only while pressed.
      if (e.pointerType !== 'mouse' && e.buttons === 0) return;
      if (e.pointerType !== 'mouse') scrubMovedRef.current = true;
      setScrubbing(true);
      scrubFromClientX(e.clientX, e.currentTarget);
    },
    [gallery, scrubFromClientX],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!gallery) return;
      scrubMovedRef.current = false;
      if (e.pointerType !== 'mouse') {
        setScrubbing(true);
        scrubFromClientX(e.clientX, e.currentTarget);
      }
    },
    [gallery, scrubFromClientX],
  );

  const endScrub = useCallback(() => {
    setScrubbing(false);
    setIndex(0);
  }, []);

  const stopCardNav = (e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onMediaClick = (e: React.MouseEvent) => {
    if (scrubMovedRef.current) {
      e.preventDefault();
      scrubMovedRef.current = false;
    }
  };

  const addVolumeToCart = useCallback(
    (opt: VolumePickerOption) => {
      if (!resolvedProductId) return;
      const addMin = Math.max(1, opt.minQty ?? 1);
      const addMax = Math.max(0, opt.maxQty ?? 0);
      if (addMax < addMin) return;
      cart.addItem(
        {
          productId: resolvedProductId,
          variantId: opt.id,
          shadeId: resolvedShadeId,
          shadeName: shadeName ?? null,
          slug,
          name,
          variantName: opt.label,
          imageUrl: urls[0] ?? imageUrl ?? null,
          price: opt.price,
          listPrice:
            opt.oldPrice != null && opt.oldPrice > opt.price
              ? opt.oldPrice
              : opt.price,
          minQty: addMin,
          maxQty: addMax,
        },
        Math.min(addMin, addMax),
      );
    },
    [
      cart,
      imageUrl,
      name,
      resolvedProductId,
      resolvedShadeId,
      shadeName,
      slug,
      urls,
    ],
  );

  const onAdd = (e: React.MouseEvent) => {
    stopCardNav(e);
    if (!resolvedProductId) return;
    if (needsVolumePick) {
      setVolumeModalOpen(true);
      return;
    }
    if (!resolvedVariantId || maxQty < minQty) return;
    cart.addItem(
      {
        productId: resolvedProductId,
        variantId: resolvedVariantId,
        shadeId: resolvedShadeId,
        shadeName: shadeName ?? null,
        slug,
        name,
        variantName: variantName ?? null,
        imageUrl: urls[0] ?? imageUrl ?? null,
        price,
        listPrice:
          oldPrice != null && oldPrice > price ? oldPrice : price,
        minQty,
        maxQty,
      },
      Math.min(minQty, maxQty),
    );
  };

  const onVolumeSelect = (opt: VolumePickerOption) => {
    addVolumeToCart(opt);
    setVolumeModalOpen(false);
  };

  const onInc = (e: React.MouseEvent) => {
    stopCardNav(e);
    if (!lineKey || qty >= maxQty) return;
    cart.setQty(lineKey, qty + 1);
  };

  const onDec = (e: React.MouseEvent) => {
    stopCardNav(e);
    if (!lineKey) return;
    const next = qty - 1;
    cart.setQty(lineKey, next < minQty ? 0 : next);
  };

  return (
    <div
      className={styles.productImgShell}
      onPointerDown={gallery ? onPointerDown : undefined}
      onPointerMove={gallery ? onPointerMove : undefined}
      onPointerLeave={gallery ? endScrub : undefined}
      onPointerCancel={gallery ? endScrub : undefined}
      onPointerUp={gallery ? () => setScrubbing(false) : undefined}
      data-gallery={gallery || undefined}
      data-scrubbing={scrubbing || undefined}
      data-in-cart={qty > 0 || undefined}
    >
      <div className={styles.productImgWrapper}>
        <Link
          href={href}
          className={styles.productImgLink}
          aria-label={name}
          onClick={onMediaClick}
        >          {currentUrl ? (
            video ? (
              <ProductCardVideo url={currentUrl} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.productImg} src={currentUrl} alt={name} loading="lazy" />
            )
          ) : (
            <div className={styles.productImgPlaceholder} aria-hidden />
          )}
        </Link>

        {gallery ? (
          <div className={styles.gallerySegments} aria-hidden>
            {urls.map((_, i) => (
              <span
                key={i}
                className={styles.gallerySegment}
                data-active={i === index || undefined}
              />
            ))}
          </div>
        ) : null}

        {discountPercent != null && discountPercent > 0 ? (
          <span className={styles.discountBadge}>{discountPercent}%</span>
        ) : null}

        {volumeOptions.length > 0 ? (
          <div className={styles.sizeRow} aria-label="Доступные объёмы">
            {volumeOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={styles.sizePill}
                aria-label={
                  needsVolumePick
                    ? `Выбрать объём: ${opt.label}`
                    : opt.label
                }
                onClick={(e) => {
                  stopCardNav(e);
                  if (needsVolumePick) setVolumeModalOpen(true);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className={styles.favoriteBtn} onClick={stopCardNav}>
          <FavoriteButton variantId={resolvedVariantId} />
        </div>
      </div>

      {canCart ? (
        qty > 0 && !needsVolumePick ? (
          <div
            className={styles.cardQtyStepper}
            aria-label="Количество в корзине"
            onClick={stopCardNav}
            onMouseDown={stopCardNav}
          >
            <button
              type="button"
              className={styles.cardQtyBtn}
              aria-label="Меньше"
              onClick={onDec}
            >
              −
            </button>
            <span className={styles.cardQtyValue}>{qty}</span>
            <button
              type="button"
              className={styles.cardQtyBtn}
              aria-label="Больше"
              disabled={qty >= maxQty}
              onClick={onInc}
            >
              +
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.cardCartBtn}
            aria-label="В корзину"
            onClick={onAdd}
            onMouseDown={stopCardNav}
          >
            <CartBagIcon />
          </button>
        )
      ) : null}

      {needsVolumePick ? (
        <VolumePickerModal
          open={volumeModalOpen}
          options={volumeOptions}
          onSelect={onVolumeSelect}
          onClose={() => setVolumeModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
