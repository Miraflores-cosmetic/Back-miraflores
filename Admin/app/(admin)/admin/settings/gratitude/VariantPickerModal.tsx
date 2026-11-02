'use client';

import { useEffect, useMemo, useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type {
  AdminProduct,
  AdminProductListItem,
  AdminProductListResponse,
} from '@/lib/adminCatalogTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

const PRODUCT_PAGE_SIZE = 50;

export type VariantPickerApplyDetails = {
  sku: string;
  price: number;
  title: string;
  /** Platform field; Miraflores catalog has no shades — always null. */
  shadeId: string | null;
  shadeName: string | null;
};

function variantLabel(productName: string, variantName: string, sku?: string) {
  const base = `${productName} — ${variantName}`;
  return sku ? `${base} (${sku})` : base;
}

export function VariantPickerModal({
  open,
  selectedVariantId,
  selectedLabel,
  onClose,
  onApply,
}: {
  open: boolean;
  selectedVariantId: string;
  selectedLabel: string;
  onClose: () => void;
  onApply: (
    variantId: string,
    label: string,
    details?: VariantPickerApplyDetails,
  ) => void;
}) {
  const [step, setStep] = useState<'products' | 'variants'>('products');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<AdminProductListItem[]>([]);
  const [pickedProduct, setPickedProduct] = useState<AdminProductListItem | null>(null);
  const [productDetail, setProductDetail] = useState<AdminProduct | null>(null);
  const [draftVariantId, setDraftVariantId] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    setStep('products');
    setQ('');
    setQDebounced('');
    setPage(1);
    setPickedProduct(null);
    setProductDetail(null);
    setDraftVariantId(selectedVariantId);
    setError(null);
  }, [open, selectedVariantId]);

  useEffect(() => {
    if (!open || step !== 'products') return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          page: String(page),
          limit: String(PRODUCT_PAGE_SIZE),
          visibility: 'all',
        });
        if (qDebounced.trim()) qs.set('q', qDebounced.trim());
        const data = await adminBackendJson<AdminProductListResponse>(
          `catalog/admin/products?${qs.toString()}`,
        );
        if (cancelled) return;
        setProducts(data.items ?? []);
        setTotal(data.total ?? 0);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof AdminBackendRequestError
              ? e.status === 403
                ? 'Нет доступа к товарам. Нужен раздел «Каталог» или «Заказы» у модератора.'
                : e.message
              : 'Ошибка загрузки',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, page, qDebounced]);

  async function pickProduct(p: AdminProductListItem) {
    setLoading(true);
    setError(null);
    try {
      const data = await adminBackendJson<AdminProduct>(`catalog/admin/products/${p.id}`);
      setPickedProduct(p);
      setProductDetail(data);
      setStep('variants');
      const variants = data.variants ?? [];
      if (variants.length === 1) {
        setDraftVariantId(variants[0]!.id);
      } else {
        setDraftVariantId('');
      }
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки вариантов');
    } finally {
      setLoading(false);
    }
  }

  const variants = useMemo(() => productDetail?.variants ?? [], [productDetail]);

  function apply() {
    if (!draftVariantId || !productDetail) return;
    const v = variants.find((x) => x.id === draftVariantId);
    if (!v) return;
    const label = variantLabel(productDetail.name, v.name, v.sku);
    onApply(draftVariantId, label, {
      sku: v.sku,
      price: v.price,
      title: label,
      shadeId: null,
      shadeName: null,
    });
    onClose();
  }

  const title =
    step === 'products'
      ? 'Выбор варианта — товар'
      : `Варианты: ${pickedProduct?.name ?? ''}`;

  return (
    <AdminModal
      open={open}
      title={title}
      wide
      onClose={onClose}
      footer={
        step === 'variants' ? (
          <AdminModalActions
            onCancel={() => {
              setStep('products');
              setPickedProduct(null);
              setProductDetail(null);
            }}
            cancelLabel="Назад"
            onConfirm={apply}
            confirmDisabled={!draftVariantId}
          />
        ) : (
          <AdminModalActions onCancel={onClose} confirmLabel="Закрыть" onConfirm={onClose} />
        )
      }
    >
      {step === 'products' ? (
        <>
          {selectedLabel ? (
            <p className={styles.muted}>
              Текущий: <strong>{selectedLabel}</strong>
            </p>
          ) : null}
          <AdminSearchBox
            placeholder="Поиск товара"
            ariaLabel="Поиск товара"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {loading ? <p className={styles.muted}>Загрузка…</p> : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {!loading && !error ? (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th style={{ width: 100 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>
                          <AdminCompactBtn
                            type="button"
                            variant="outline"
                            onClick={() => void pickProduct(p)}
                          >
                            Выбрать
                          </AdminCompactBtn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {products.length === 0 ? <p className={styles.muted}>Ничего не найдено</p> : null}
              </div>
              <AdminListPagination
                page={page}
                limit={PRODUCT_PAGE_SIZE}
                total={total}
                onPageChange={setPage}
              />
            </>
          ) : null}
        </>
      ) : (
        <>
          {loading ? <p className={styles.muted}>Загрузка…</p> : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {!loading && !error ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }} />
                    <th>Вариант</th>
                    <th>SKU</th>
                    <th>Цена</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <input
                          type="radio"
                          name="variant-pick"
                          checked={draftVariantId === v.id}
                          onChange={() => setDraftVariantId(v.id)}
                          aria-label={v.name}
                        />
                      </td>
                      <td>{v.name}</td>
                      <td>{v.sku}</td>
                      <td>{v.price} ₽</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {variants.length === 0 ? (
                <p className={styles.muted}>У товара нет вариантов</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </AdminModal>
  );
}
