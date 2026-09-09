'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  discountPercent,
  fetchPublicProductClient,
  formatRub,
  type PublicProduct,
} from '@/lib/publicCatalog';
import { useBuyerAuth } from '@/lib/BuyerAuthProvider';
import { useCart } from '@/lib/cart/CartContext';
import { sanitizeProductHtml } from '@/lib/sanitizeProductHtml';
import { PrimaryBtn } from '@/components/PrimaryBtn/PrimaryBtn';
import { FavoriteButton } from '@/components/FavoriteButton/FavoriteButton';
import { ProductGallery } from './ProductGallery';
import styles from './ProductInteractive.module.css';

const ACCORDIONS = [
  { id: 'description', title: 'Описание', field: 'descriptionHtml' as const },
  { id: 'action', title: 'Действие и эффект', field: 'actionEffectHtml' as const },
  { id: 'composition', title: 'Состав', field: 'compositionHtml' as const },
  { id: 'application', title: 'Способ применения', field: 'applicationHtml' as const },
  { id: 'important', title: 'Важно знать!', field: 'importantNoteHtml' as const },
  { id: 'miraflores', title: 'Комментарий Miraflores', field: 'mirafloresNoteHtml' as const },
];

const ATTR_META: Array<{
  label: string;
  value: (p: PublicProduct) => string | null | undefined;
}> = [
  { label: 'Тип продукта', value: (p) => p.productType },
  { label: 'Для чего', value: (p) => p.purpose },
  { label: 'Срок годности', value: (p) => p.shelfLife },
  { label: 'Хранение', value: (p) => p.storageHtml },
];

type Props = {
  product: PublicProduct;
  categoryBack: { label: string; href: string };
  initialVariantId?: string;
  initialShadeId?: string;
};

export function ProductInteractive({
  product: initialProduct,
  categoryBack,
  initialVariantId,
  initialShadeId,
}: Props) {
  const cart = useCart();
  const router = useRouter();
  const pathname = usePathname();
  const { ready: buyerReady, authenticated: buyerAuthed } = useBuyerAuth();
  const [product, setProduct] = useState(initialProduct);

  useEffect(() => {
    setProduct(initialProduct);
  }, [initialProduct]);

  useEffect(() => {
    if (!buyerReady || !buyerAuthed) return;
    void (async () => {
      const fresh = await fetchPublicProductClient(initialProduct.slug);
      if (fresh) setProduct(fresh);
    })();
  }, [buyerReady, buyerAuthed, initialProduct.slug]);

  const hasVariants = product.variants.length > 0;
  const [variantId, setVariantId] = useState(
    initialVariantId || product.variants[0]?.id || '',
  );
  const [shadeId, setShadeId] = useState<string | null>(initialShadeId ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stickyBuy, setStickyBuy] = useState(false);
  const purchaseSentinelRef = useRef<HTMLDivElement | null>(null);

  const variant = useMemo(() => {
    if (!hasVariants) return null;
    return product.variants.find((v) => v.id === variantId) ?? product.variants[0] ?? null;
  }, [hasVariants, product.variants, variantId]);

  const shades = variant?.shades ?? [];
  const selectedShade = useMemo(() => {
    if (!shades.length) return null;
    return shades.find((s) => s.id === shadeId) ?? shades[0] ?? null;
  }, [shades, shadeId]);

  const syncVariantQuery = useCallback(
    (vId: string, sId: string | null) => {
      const params = new URLSearchParams();
      if (vId) params.set('v', vId);
      if (sId) params.set('shade', sId);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    if (!initialVariantId) return;
    setVariantId((prev) => (prev === initialVariantId ? prev : initialVariantId));
  }, [initialVariantId]);

  useEffect(() => {
    if (initialShadeId == null) return;
    setShadeId((prev) => (prev === initialShadeId ? prev : initialShadeId));
  }, [initialShadeId]);

  useEffect(() => {
    if (!variant?.id) return;
    syncVariantQuery(variant.id, selectedShade?.id ?? null);
  }, [variant?.id, selectedShade?.id, syncVariantQuery]);

  const galleryImages = useMemo(() => {
    const fromVariant = variant?.images ?? [];
    if (fromVariant.length) {
      return fromVariant.map((i) => ({ url: i.url, mediaType: i.mediaType }));
    }
    return product.images.map((i) => ({ url: i.url, mediaType: i.mediaType }));
  }, [product.images, variant]);

  const minQty = Math.max(1, variant?.orderMinQty ?? 1);
  const maxQty = useMemo(() => {
    if (!variant) return 0;
    const stockCap = Math.max(0, variant.available);
    if (stockCap <= 0) return 0;
    if (variant.orderMaxQty != null) return Math.min(variant.orderMaxQty, stockCap);
    return stockCap;
  }, [variant]);

  const saleDiscount = variant ? discountPercent(variant.price, variant.compareAt) : null;
  const visibleAccordions = ACCORDIONS.filter(({ field }) =>
    Boolean(sanitizeProductHtml(product[field])),
  );
  const soldOut = !variant || maxQty <= 0;
  const showPurchase = hasVariants;

  const cartQty = variant ? cart.getQty(variant.id, selectedShade?.id ?? null) : 0;
  const lineKey = variant ? cart.lineKey(variant.id, selectedShade?.id ?? null) : '';

  const imageForCart =
    variant?.images[0]?.url ||
    product.images[0]?.url ||
    selectedShade?.imageUrl ||
    null;

  const descriptionHtml = sanitizeProductHtml(product.descriptionHtml);

  const onAdd = () => {
    if (soldOut || !variant || maxQty <= 0) return;
    cart.addItem(
      {
        productId: product.id,
        variantId: variant.id,
        shadeId: selectedShade?.id ?? null,
        shadeName: selectedShade?.name ?? null,
        slug: product.slug,
        name: product.name,
        variantName: variant.name,
        imageUrl: imageForCart,
        price: variant.price,
        listPrice:
          variant.compareAt != null && variant.compareAt > variant.price
            ? variant.compareAt
            : variant.price,
        minQty,
        maxQty,
      },
      Math.min(minQty, maxQty),
    );
  };

  const onDec = () => {
    if (!variant) return;
    const next = cartQty - 1;
    cart.setQty(lineKey, next < minQty ? 0 : next);
  };

  const onInc = () => {
    if (!variant || maxQty <= 0) return;
    cart.setQty(lineKey, Math.min(maxQty, cartQty + 1));
  };

  const onSelectVariant = (id: string) => {
    setVariantId(id);
    setShadeId(null);
  };

  const onSelectShade = (id: string) => {
    setShadeId(id);
  };

  const canSticky =
    showPurchase && !soldOut && (cartQty > 0 || Boolean(variant));
  const stickyVisible = stickyBuy && canSticky && !cart.open;

  useEffect(() => {
    const el = purchaseSentinelRef.current;
    if (!el || !canSticky) {
      setStickyBuy(false);
      return;
    }

    const mq = window.matchMedia('(max-width: 960px)');
    const sync = () => {
      if (!mq.matches) {
        setStickyBuy(false);
      }
    };
    sync();
    mq.addEventListener('change', sync);

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!mq.matches) {
          setStickyBuy(false);
          return;
        }
        setStickyBuy(!entry?.isIntersecting);
      },
      { threshold: 0, rootMargin: '0px' },
    );
    io.observe(el);

    return () => {
      mq.removeEventListener('change', sync);
      io.disconnect();
    };
  }, [canSticky, cartQty, soldOut, variant?.id]);

  const priceNode = (
    <div className={styles.priceBlock}>
      <span className={styles.price}>{formatRub(variant?.price ?? 0)}</span>
      {variant?.compareAt != null && variant.compareAt > variant.price ? (
        <span className={styles.oldPrice}>{formatRub(variant.compareAt)}</span>
      ) : null}
      {saleDiscount != null ? (
        <span className={styles.discount}>−{saleDiscount}%</span>
      ) : null}
    </div>
  );

  const purchaseControls = (() => {
    if (!showPurchase) {
      return (
        <p className={`${styles.unavailable} ${styles.purchaseActions}`} role="status">
          Скоро в продаже
        </p>
      );
    }
    if (cartQty > 0 && !soldOut) {
      return (
        <div
          className={`${styles.qtyStepper} ${styles.purchaseActions}`}
          aria-label="Количество в корзине"
        >
          <button type="button" className={styles.qtyBtn} onClick={onDec} aria-label="Меньше">
            −
          </button>
          <span className={styles.qtyValue}>{cartQty}</span>
          <button
            type="button"
            className={styles.qtyBtn}
            onClick={onInc}
            disabled={cartQty >= maxQty}
            aria-label="Больше"
          >
            +
          </button>
        </div>
      );
    }
    if (soldOut) {
      return (
        <p className={`${styles.unavailable} ${styles.purchaseActions}`} role="status">
          Нет в наличии
        </p>
      );
    }
    return (
      <PrimaryBtn className={`${styles.inlineAtc} ${styles.purchaseActions}`} onClick={onAdd}>
        В корзину
      </PrimaryBtn>
    );
  })();

  return (
    <div className={styles.productGrid}>
      <div className={styles.galleryCol}>
        <ProductGallery
          key={variant?.id ?? 'no-variant'}
          images={galleryImages}
          productName={product.name}
        />
      </div>

      <div className={styles.productDetailsRight}>
        <div className={styles.productTitles}>
          <nav className={styles.breadcrumbsMobile} aria-label="Хлебные крошки">
            <Link href={categoryBack.href} className={styles.breadcrumbsBack}>
              <svg
                className={styles.breadcrumbsBackIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden
              >
                <path
                  d="M10 3.5 5.5 8 10 12.5"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={styles.breadcrumbsBackLabel}>{categoryBack.label}</span>
            </Link>
          </nav>
          <Link href="/" className={styles.productBrandName}>
            Jcos
          </Link>
          <h1 className={styles.productName}>{product.name}</h1>
          {ATTR_META.some(({ value }) => value(product)?.trim()) ? (
            <dl className={styles.attrMeta}>
              {ATTR_META.map(({ label, value }) => {
                const text = value(product)?.trim();
                if (!text) return null;
                return (
                  <div key={label} className={styles.attrMetaRow}>
                    <dt>{label}</dt>
                    <dd>{text}</dd>
                  </div>
                );
              })}
            </dl>
          ) : null}
          {product.pageShortDescriptionHtml ? (
            <div
              className={styles.productShortHtml}
              dangerouslySetInnerHTML={{
                __html: sanitizeProductHtml(product.pageShortDescriptionHtml),
              }}
            />
          ) : product.shortDescription ? (
            <p className={styles.productShort}>{product.shortDescription}</p>
          ) : null}
        </div>

        {showPurchase ? priceNode : null}

        {product.variants.length > 1 ? (
          <div className={styles.variants}>
            <span className={styles.variantLabel} id="product-variant-label">
              Вариант: <strong>{variant?.name}</strong>
              {variant?.volumeMl != null ? ` · ${variant.volumeMl} мл` : null}
            </span>
            <ul
              className={styles.variantPills}
              role="list"
              aria-labelledby="product-variant-label"
            >
              {product.variants.map((v) => {
                const active = v.id === variant?.id;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      className={styles.variantPill}
                      data-active={active || undefined}
                      aria-pressed={active}
                      onClick={() => onSelectVariant(v.id)}
                    >
                      {v.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {shades.length > 0 ? (
          <div className={styles.variants}>
            <span className={styles.variantLabel} id="product-shade-label">
              Оттенок: <strong>{selectedShade?.name}</strong>
              {variant?.volumeMl != null ? ` · ${variant.volumeMl} мл` : null}
            </span>
            <ul className={styles.swatches} role="list" aria-labelledby="product-shade-label">
              {shades.map((s) => {
                const active = s.id === selectedShade?.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={styles.swatchBtn}
                      data-active={active || undefined}
                      title={s.name}
                      aria-label={s.name}
                      aria-pressed={active}
                      onClick={() => onSelectShade(s.id)}
                    >
                      {s.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.imageUrl} alt="" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : variant?.volumeMl != null ? (
          <span className={styles.variantLabel}>{variant.volumeMl} мл</span>
        ) : null}

        <div ref={purchaseSentinelRef} className={styles.purchaseSlot}>
          <div className={styles.purchaseRow}>
            {purchaseControls}
            {variant ? (
              <FavoriteButton variantId={variant.id} className={styles.pdpFavorite} />
            ) : null}
          </div>
        </div>

        {descriptionHtml ? (
          <div className={styles.descriptionWrapper}>
            <div
              className={styles.descriptionText}
              dangerouslySetInnerHTML={{ __html: descriptionHtml }}
            />
          </div>
        ) : null}

        {visibleAccordions.length > 0 ? (
          <div className={styles.accordions}>
            {visibleAccordions.map(({ id, title, field }) => {
              const open = openId === id;
              const html = sanitizeProductHtml(product[field]);
              if (!html) return null;
              const panelId = `product-acc-${id}`;
              return (
                <div key={id} className={styles.accordion}>
                  <button
                    type="button"
                    className={styles.trigger}
                    aria-expanded={open}
                    aria-controls={panelId}
                    id={`${panelId}-trigger`}
                    onClick={() => setOpenId(open ? null : id)}
                  >
                    <span>{title}</span>
                    <span className={styles.chevron} data-open={open || undefined} aria-hidden>
                      <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
                        <path d="M11 4v14M4 11h14" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                    </span>
                  </button>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={`${panelId}-trigger`}
                    hidden={!open}
                    className={styles.panel}
                    tabIndex={open ? -1 : undefined}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {canSticky ? (
        <div
          className={styles.stickyBuy}
          data-visible={stickyVisible || undefined}
          aria-hidden={!stickyVisible}
          {...(!stickyVisible ? { inert: true } : {})}
        >
          <div className={styles.stickyPrice}>{formatRub(variant?.price ?? 0)}</div>
          {cartQty > 0 ? (
            <div className={styles.stickyStepper} aria-label="Количество в корзине">
              <button
                type="button"
                className={styles.qtyBtn}
                onClick={onDec}
                aria-label="Меньше"
                tabIndex={stickyVisible ? 0 : -1}
              >
                −
              </button>
              <span className={styles.qtyValue}>{cartQty}</span>
              <button
                type="button"
                className={styles.qtyBtn}
                onClick={onInc}
                disabled={cartQty >= maxQty}
                aria-label="Больше"
                tabIndex={stickyVisible ? 0 : -1}
              >
                +
              </button>
            </div>
          ) : (
            <PrimaryBtn
              className={styles.stickyAtc}
              onClick={onAdd}
              tabIndex={stickyVisible ? 0 : -1}
            >
              В корзину
            </PrimaryBtn>
          )}
        </div>
      ) : null}
    </div>
  );
}
