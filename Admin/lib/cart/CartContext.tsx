'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cartLineKey, productCartHref } from './cartUtils';
import {
  computeCatalogDiscount,
  computeListSubtotal,
  computeLocalDiscount,
  computePayableTotal,
  computeSubtotal,
} from './cartTotals';
import { getOrCreateGuestId } from './guestId';
import { MENU_COVERED_EVENT } from '@/components/SiteTransition';
import { useToast } from '@/components/Toast/ToastProvider';

export { cartLineKey, productCartHref } from './cartUtils';
export {
  computeCatalogDiscount,
  computeListSubtotal,
  computeLocalDiscount,
  computePayableTotal,
  computeSubtotal,
} from './cartTotals';

export type CartLineInput = {
  productId: string;
  variantId: string;
  shadeId?: string | null;
  shadeName?: string | null;
  slug: string;
  name: string;
  variantName?: string | null;
  imageUrl?: string | null;
  /** Цена к оплате (после каталожной скидки) */
  price: number;
  /** Сырая цена варианта до кампании; если > price — зачёркивание в drawer */
  listPrice?: number | null;
  /** Минимальный заказной qty (orderMinQty) */
  minQty?: number | null;
  maxQty?: number | null;
};

export type CartLine = CartLineInput & {
  key: string;
  qty: number;
  minQty: number;
  maxQty: number | null;
};

type CartSyncResponse = {
  items: Array<{
    productId: string;
    variantId: string;
    shadeId: string | null;
    shadeName: string | null;
    slug: string;
    name: string;
    variantName: string | null;
    imageUrl: string | null;
    price: number;
    listPrice?: number;
    minQty: number;
    maxQty: number;
    qty: number;
  }>;
  removedKeys: string[];
  removedLines?: Array<{ key: string; reason: 'oos' | 'missing'; name?: string }>;
};

export type AppliedPromo = {
  /** promo = скидка; gift = предоплата с сертификата */
  kind: 'promo' | 'gift';
  code: string;
  type: string;
  value: number;
  discountAmount: number;
};

type CartContextValue = {
  items: CartLine[];
  itemCount: number;
  subtotal: number;
  /** Сумма по listPrice (для strikethrough / «Сумма»). */
  listSubtotal: number;
  /** Σ (list − price) × qty. */
  catalogDiscount: number;
  discountAmount: number;
  total: number;
  promo: AppliedPromo | null;
  promoBusy: boolean;
  applyPromo: (
    code: string,
    opts?: { shippingRub?: number | null },
  ) => Promise<
    | { ok: true; kind: 'promo' | 'gift' }
    | { ok: false; message: string }
  >;
  /** Пересчёт gift с актуальной доставкой (checkout). */
  revalidatePromoForShipping: (
    shippingRub: number | null,
  ) => Promise<void>;
  clearPromo: () => void;
  open: boolean;
  hydrated: boolean;
  syncing: boolean;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
  addItem: (input: CartLineInput, qty?: number, opts?: { openDrawer?: boolean }) => void;
  setQty: (key: string, qty: number) => void;
  removeItem: (key: string) => void;
  clearCart: () => void;
  getQty: (variantId: string, shadeId?: string | null) => number;
  lineKey: (variantId: string, shadeId?: string | null) => string;
  /** Refresh price/stock; drop dead variants. */
  syncCart: () => Promise<SyncCartResult>;
  /** Element to restore focus after drawer closes (bag button). */
  returnFocusRef: React.MutableRefObject<HTMLElement | null>;
};

export type SyncCartRemovedLine = {
  key: string;
  reason: 'oos' | 'missing';
  name?: string;
};

export type SyncCartResult = {
  ok: boolean;
  removed: SyncCartRemovedLine[];
  error?: string;
};

const STORAGE_KEY = 'miraflores.cart.v1';
const PROMO_STORAGE_KEY = 'miraflores.cart.promo.v1';

const CartContext = createContext<CartContextValue | null>(null);

function normalizeMinQty(raw: number | null | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function normalizeMaxQty(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function loadStored(): CartLine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is CartLine => {
        if (!row || typeof row !== 'object') return false;
        const r = row as CartLine;
        return (
          typeof r.variantId === 'string' &&
          typeof r.productId === 'string' &&
          typeof r.slug === 'string' &&
          typeof r.name === 'string' &&
          typeof r.price === 'number' &&
          typeof r.qty === 'number' &&
          r.qty > 0
        );
      })
      .map((r) => {
        const minQty = normalizeMinQty(r.minQty);
        const maxQty = normalizeMaxQty(r.maxQty ?? null);
        let qty = Math.floor(r.qty);
        if (maxQty != null && maxQty > 0) qty = Math.min(maxQty, qty);
        qty = Math.max(minQty, qty);
        return {
          ...r,
          key: r.key || cartLineKey(r.variantId, r.shadeId),
          imageUrl: r.imageUrl ?? null,
          shadeId: r.shadeId ?? null,
          shadeName: r.shadeName ?? null,
          variantName: r.variantName ?? null,
          minQty,
          maxQty,
          qty,
        };
      });
  } catch {
    return [];
  }
}

function loadStoredPromoCode(): { code: string; kind: 'promo' | 'gift' } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PROMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: string; kind?: string };
    if (typeof parsed.code !== 'string' || !parsed.code.trim()) return null;
    const kind = parsed.kind === 'gift' ? 'gift' : 'promo';
    return { code: parsed.code.trim(), kind };
  } catch {
    return null;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const [items, setItems] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const syncOnceRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const promoCodeRef = useRef<{ code: string; kind: 'promo' | 'gift' } | null>(null);

  // До paint — чтобы badge не мигал 0 → N
  useLayoutEffect(() => {
    setItems(loadStored());
    promoCodeRef.current = loadStoredPromoCode();
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* ignore quota */
    }
  }, [items, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (promo?.code) {
        window.localStorage.setItem(
          PROMO_STORAGE_KEY,
          JSON.stringify({ code: promo.code, kind: promo.kind }),
        );
        promoCodeRef.current = { code: promo.code, kind: promo.kind };
      } else if (!promoCodeRef.current) {
        window.localStorage.removeItem(PROMO_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [promo, hydrated]);

  const subtotal = useMemo(() => computeSubtotal(items), [items]);
  const listSubtotal = useMemo(() => computeListSubtotal(items), [items]);
  const catalogDiscount = useMemo(() => computeCatalogDiscount(items), [items]);

  const refreshPromo = useCallback(
    async (code: string, goodsAmount: number, shippingRub?: number | null) => {
      const trimmed = code.trim();
      if (!trimmed) {
        setPromo(null);
        promoCodeRef.current = null;
        try {
          window.localStorage.removeItem(PROMO_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        return { ok: false as const, message: 'Введите промокод или сертификат' };
      }
      const appliedNorm = (promoCodeRef.current?.code ?? '').trim().toUpperCase();
      const requestNorm = trimmed.toUpperCase();

      const clearIfSameApplied = (isClientReject: boolean) => {
        if (isClientReject && appliedNorm && appliedNorm === requestNorm) {
          setPromo(null);
          promoCodeRef.current = null;
          try {
            window.localStorage.removeItem(PROMO_STORAGE_KEY);
          } catch {
            /* ignore */
          }
        }
      };

      const goods = Math.max(0, Math.floor(goodsAmount));
      const ship = Math.max(0, Math.floor(shippingRub ?? 0));

      try {
        // 1) Подарочный сертификат — payable = товары + доставка (как на create).
        const giftRes = await fetch('/api/public/gift-certificates/validate', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: trimmed,
            payableBeforeGift: goods + ship,
          }),
          cache: 'no-store',
        });
        const giftData = (await giftRes.json().catch(() => ({}))) as {
          message?: string | string[];
          kind?: string;
          code?: string;
          applyAmount?: number;
        };
        if (giftRes.ok && giftData.kind === 'gift') {
          const applyAmount =
            typeof giftData.applyAmount === 'number' && Number.isFinite(giftData.applyAmount)
              ? giftData.applyAmount
              : 0;
          if (applyAmount >= 1) {
            const next: AppliedPromo = {
              kind: 'gift',
              code: giftData.code ?? trimmed.toUpperCase(),
              type: 'GIFT',
              value: applyAmount,
              discountAmount: applyAmount,
            };
            setPromo(next);
            promoCodeRef.current = { code: next.code, kind: 'gift' };
            return { ok: true as const, kind: 'gift' as const };
          }
        }

        // 2) Промокод — только товары.
        const res = await fetch('/api/public/promo/validate', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: trimmed,
            subtotal: goods,
            guestId: getOrCreateGuestId() || undefined,
          }),
          cache: 'no-store',
        });
        const data = (await res.json().catch(() => ({}))) as {
          message?: string | string[];
          code?: string;
          type?: string;
          value?: number;
          discountAmount?: number;
        };
        if (!res.ok) {
          const giftMsg = Array.isArray(giftData.message)
            ? giftData.message[0]
            : typeof giftData.message === 'string'
              ? giftData.message
              : null;
          const msg = Array.isArray(data.message)
            ? data.message[0]
            : typeof data.message === 'string'
              ? data.message
              : giftMsg || 'Код недействителен';
          const isClientReject = res.status >= 400 && res.status < 500;
          clearIfSameApplied(isClientReject);
          return {
            ok: false as const,
            message: isClientReject ? msg || 'Код недействителен' : 'Не удалось проверить код',
          };
        }
        if (data.type !== 'PERCENT' && data.type !== 'FIXED') {
          return { ok: false as const, message: 'Некорректный ответ сервера' };
        }
        if (typeof data.value !== 'number' || !Number.isFinite(data.value)) {
          return { ok: false as const, message: 'Некорректный ответ сервера' };
        }
        const next: AppliedPromo = {
          kind: 'promo',
          code: data.code ?? trimmed.toUpperCase(),
          type: data.type,
          value: data.value,
          discountAmount:
            typeof data.discountAmount === 'number' && Number.isFinite(data.discountAmount)
              ? data.discountAmount
              : 0,
        };
        setPromo(next);
        promoCodeRef.current = { code: next.code, kind: 'promo' };
        return { ok: true as const, kind: 'promo' as const };
      } catch {
        return { ok: false as const, message: 'Не удалось проверить код' };
      }
    },
    [],
  );

  const applyPromo = useCallback(
    async (code: string, opts?: { shippingRub?: number | null }) => {
      setPromoBusy(true);
      try {
        return await refreshPromo(code, subtotal, opts?.shippingRub);
      } finally {
        setPromoBusy(false);
      }
    },
    [refreshPromo, subtotal],
  );

  const revalidatePromoForShipping = useCallback(
    async (shippingRub: number | null) => {
      const code = promo?.code ?? promoCodeRef.current?.code;
      const kind = promo?.kind ?? promoCodeRef.current?.kind;
      if (!code || kind !== 'gift') return;
      if (shippingRub == null) return;
      setPromoBusy(true);
      try {
        await refreshPromo(code, subtotal, shippingRub);
      } finally {
        setPromoBusy(false);
      }
    },
    [promo?.code, promo?.kind, refreshPromo, subtotal],
  );

  const clearPromo = useCallback(() => {
    setPromo(null);
    promoCodeRef.current = null;
    try {
      window.localStorage.removeItem(PROMO_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Пересчёт при изменении суммы / восстановление из storage (без shipping — drawer).
  useEffect(() => {
    if (!hydrated) return;
    const stored = promo?.code
      ? { code: promo.code, kind: promo.kind }
      : promoCodeRef.current;
    if (!stored?.code) return;
    if (items.length === 0) {
      setPromo(null);
      return;
    }
    void refreshPromo(stored.code, subtotal);
  }, [hydrated, items.length, subtotal, promo?.code, promo?.kind, refreshPromo]);

  const syncCart = useCallback(async (): Promise<SyncCartResult> => {
    const snapshot = itemsRef.current;
    if (!snapshot.length) {
      return { ok: true, removed: [] };
    }
    setSyncing(true);
    try {
      const res = await fetch('/api/public/catalog/cart/sync', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: snapshot.map((l) => ({
            variantId: l.variantId,
            shadeId: l.shadeId ?? null,
            qty: l.qty,
          })),
        }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const msg = 'Не удалось обновить корзину. Проверьте соединение и попробуйте снова.';
        showToast(msg);
        return { ok: false, removed: [], error: msg };
      }
      const data = (await res.json()) as CartSyncResponse;
      const removed: SyncCartRemovedLine[] = data.removedLines?.length
        ? data.removedLines
        : (data.removedKeys ?? []).map((key) => ({
            key,
            reason: 'missing' as const,
          }));
      if (removed.length) {
        const names = removed
          .map((r) => r.name)
          .filter(Boolean)
          .slice(0, 3) as string[];
        showToast(
          names.length
            ? `Убрано (нет в наличии): ${names.join(', ')}${removed.length > names.length ? '…' : ''}`
            : `Убрано из корзины: ${removed.length} поз.`,
        );
      }
      const next: CartLine[] = (data.items ?? []).map((row) => ({
        productId: row.productId,
        variantId: row.variantId,
        shadeId: row.shadeId,
        shadeName: row.shadeName,
        slug: row.slug,
        name: row.name,
        variantName: row.variantName,
        imageUrl: row.imageUrl,
        price: row.price,
        listPrice: row.listPrice ?? row.price,
        minQty: normalizeMinQty(row.minQty),
        maxQty: normalizeMaxQty(row.maxQty),
        qty: row.qty,
        key: cartLineKey(row.variantId, row.shadeId),
      }));
      const seen = new Set<string>();
      const deduped: CartLine[] = [];
      for (const line of next) {
        if (seen.has(line.key)) {
          const i = deduped.findIndex((x) => x.key === line.key);
          if (i >= 0) {
            const cap = deduped[i]!.maxQty;
            const merged = deduped[i]!.qty + line.qty;
            deduped[i] = {
              ...deduped[i]!,
              qty: cap != null && cap > 0 ? Math.min(cap, merged) : merged,
            };
          }
          continue;
        }
        seen.add(line.key);
        deduped.push(line);
      }
      setItems(deduped);
      return { ok: true, removed };
    } catch {
      const msg = 'Не удалось обновить корзину. Проверьте соединение и попробуйте снова.';
      showToast(msg);
      return { ok: false, removed: [], error: msg };
    } finally {
      setSyncing(false);
    }
  }, [showToast]);

  // После hydrate — один раз почистить мёртвые variantId
  useEffect(() => {
    if (!hydrated || syncOnceRef.current) return;
    syncOnceRef.current = true;
    if (itemsRef.current.length) void syncCart();
  }, [hydrated, syncCart]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const coverChrome = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MENU_COVERED_EVENT));
  }, []);

  const openCart = useCallback(() => {
    coverChrome();
    const ae = document.activeElement;
    if (ae instanceof HTMLElement) returnFocusRef.current = ae;
    setOpen(true);
    void syncCart();
  }, [syncCart, coverChrome]);

  const closeCart = useCallback(() => setOpen(false), []);
  const toggleCart = useCallback(() => {
    setOpen((v) => {
      if (!v) {
        coverChrome();
        const ae = document.activeElement;
        if (ae instanceof HTMLElement) returnFocusRef.current = ae;
        void syncCart();
      }
      return !v;
    });
  }, [syncCart, coverChrome]);

  const addItem = useCallback(
    (input: CartLineInput, qty = 1, opts?: { openDrawer?: boolean }) => {
      const key = cartLineKey(input.variantId, input.shadeId);
      const minQty = normalizeMinQty(input.minQty);
      const cap = normalizeMaxQty(input.maxQty ?? null);
      if (cap === 0) return;
      const addQty = Math.max(minQty, Math.floor(qty));
      setItems((prev) => {
        const existing = prev.find((l) => l.key === key);
        if (existing) {
          const nextQty = existing.qty + Math.max(1, Math.floor(qty));
          const limited = cap != null ? Math.min(cap, Math.max(minQty, nextQty)) : Math.max(minQty, nextQty);
          return prev.map((l) =>
            l.key === key
              ? {
                  ...l,
                  qty: limited,
                  price: input.price,
                  minQty,
                  maxQty: cap ?? l.maxQty,
                  shadeName: input.shadeName ?? l.shadeName,
                  variantName: input.variantName ?? l.variantName,
                  imageUrl: input.imageUrl ?? l.imageUrl,
                }
              : l,
          );
        }
        const initial = cap != null ? Math.min(cap, addQty) : addQty;
        if (initial < minQty || initial <= 0) return prev;
        return [
          ...prev,
          {
            ...input,
            key,
            shadeId: input.shadeId ?? null,
            shadeName: input.shadeName ?? null,
            variantName: input.variantName ?? null,
            imageUrl: input.imageUrl ?? null,
            minQty,
            maxQty: cap,
            qty: initial,
          },
        ];
      });
      if (opts?.openDrawer) {
        coverChrome();
        setOpen(true);
      } else {
        showToast('Добавлено в корзину');
      }
    },
    [coverChrome, showToast],
  );

  const setQty = useCallback((key: string, qty: number) => {
    const next = Math.floor(qty);
    setItems((prev) => {
      const line = prev.find((l) => l.key === key);
      if (!line) return prev;
      const minQty = normalizeMinQty(line.minQty);
      if (next < minQty) return prev.filter((l) => l.key !== key);
      const cap = line.maxQty != null && line.maxQty > 0 ? line.maxQty : null;
      const limited = cap != null ? Math.min(cap, next) : next;
      return prev.map((l) => (l.key === key ? { ...l, qty: limited } : l));
    });
  }, []);

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    clearPromo();
  }, [clearPromo]);

  const getQty = useCallback(
    (variantId: string, shadeId?: string | null) => {
      const key = cartLineKey(variantId, shadeId);
      return items.find((l) => l.key === key)?.qty ?? 0;
    },
    [items],
  );

  const itemCount = useMemo(
    () => items.reduce((sum, l) => sum + l.qty, 0),
    [items],
  );

  const discountAmount = useMemo(() => {
    if (!promo) return 0;
    if (promo.kind === 'gift') return Math.max(0, Math.floor(promo.discountAmount));
    return computeLocalDiscount(promo.type, promo.value, subtotal);
  }, [promo, subtotal]);

  const total = useMemo(
    () => computePayableTotal(subtotal, discountAmount),
    [subtotal, discountAmount],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      itemCount,
      subtotal,
      listSubtotal,
      catalogDiscount,
      discountAmount,
      total,
      promo: promo
        ? {
            ...promo,
            discountAmount,
            kind: promo.kind ?? 'promo',
          }
        : null,
      promoBusy,
      applyPromo,
      revalidatePromoForShipping,
      clearPromo,
      open,
      hydrated,
      syncing,
      openCart,
      closeCart,
      toggleCart,
      addItem,
      setQty,
      removeItem,
      clearCart,
      getQty,
      lineKey: cartLineKey,
      syncCart,
      returnFocusRef,
    }),
    [
      items,
      itemCount,
      subtotal,
      listSubtotal,
      catalogDiscount,
      discountAmount,
      total,
      promo,
      promoBusy,
      applyPromo,
      revalidatePromoForShipping,
      clearPromo,
      open,
      hydrated,
      syncing,
      openCart,
      closeCart,
      toggleCart,
      addItem,
      setQty,
      removeItem,
      clearCart,
      getQty,
      syncCart,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
