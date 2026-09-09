'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DiscountProductPickerModal } from '@/app/(admin)/admin/discounts/DiscountScopePickerModal';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import type { AdminProduct, AdminVariant } from '@/lib/adminCatalogTypes';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type {
  AdminGroupVariantPriceListResponse,
  AdminGroupVariantPriceRow,
  AdminUserGroup,
} from '@/lib/adminUserGroupTypes';
import { computePercentOffPrice } from '@/lib/userGroupPricing';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import settingsStyles from '@/app/(admin)/admin/settings/Settings.module.css';

const PAGE_SIZE = 25;

type ProductPriceMode = 'percent' | 'fixed';

function variantRowKey(v: AdminVariant) {
  return v.sku ? `${v.name} (${v.sku})` : v.name;
}

export function UserGroupProductPricesTab({
  groupId,
  priceRounding,
  totalCount,
  onChanged,
}: {
  groupId: string;
  priceRounding: AdminUserGroup['priceRounding'];
  totalCount: number;
  onChanged: () => void;
}) {
  const { showToast } = useToast();

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productDetail, setProductDetail] = useState<AdminProduct | null>(null);
  const [productLoading, setProductLoading] = useState(false);
  const [existingByVariant, setExistingByVariant] = useState<Map<string, number>>(new Map());

  const [mode, setMode] = useState<ProductPriceMode>('percent');
  const [percentInput, setPercentInput] = useState('10');
  const [fixedByVariant, setFixedByVariant] = useState<Record<string, string>>({});
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(totalCount);
  const [items, setItems] = useState<AdminGroupVariantPriceRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listSaving, setListSaving] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [deleteVariantId, setDeleteVariantId] = useState<string | null>(null);
  const [deleteLabel, setDeleteLabel] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const sp = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (qDebounced.trim()) sp.set('q', qDebounced.trim());
      const res = await adminBackendJson<AdminGroupVariantPriceListResponse>(
        `user-groups/admin/${groupId}/variant-prices?${sp}`,
      );
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setListError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить');
    } finally {
      setListLoading(false);
    }
  }, [groupId, page, qDebounced]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadProduct = useCallback(
    async (productId: string, productName: string) => {
      setProductLoading(true);
      setProductError(null);
      try {
        const [detail, pricesRes] = await Promise.all([
          adminBackendJson<AdminProduct>(`catalog/admin/products/${productId}`),
          adminBackendJson<AdminGroupVariantPriceListResponse>(
            `user-groups/admin/${groupId}/variant-prices?${new URLSearchParams({
              page: '1',
              limit: '200',
              q: productName,
            })}`,
          ),
        ]);
        setProductDetail(detail);
        setSelectedProductId(productId);
        setSelectedProductName(productName);
        const map = new Map<string, number>();
        for (const row of pricesRes.items) {
          if (row.productId === productId) map.set(row.variantId, row.price);
        }
        setExistingByVariant(map);
        const fixed: Record<string, string> = {};
        for (const v of detail.variants ?? []) {
          fixed[v.id] = map.has(v.id) ? String(map.get(v.id)) : '';
        }
        setFixedByVariant(fixed);
        setMode('percent');
        setPercentInput('10');
      } catch (e) {
        setProductError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить товар');
      } finally {
        setProductLoading(false);
      }
    },
    [groupId],
  );

  const variants = useMemo(() => productDetail?.variants ?? [], [productDetail]);

  const previewRows = useMemo(() => {
    const pct = Number(percentInput);
    return variants.map((v) => {
      const base = v.price;
      const current = existingByVariant.get(v.id);
      let next: number | null = null;
      if (mode === 'percent' && Number.isFinite(pct)) {
        next = computePercentOffPrice(base, pct, priceRounding);
      } else {
        const raw = fixedByVariant[v.id];
        const n = raw != null && raw !== '' ? Number(raw) : NaN;
        if (Number.isFinite(n)) next = Math.floor(n);
      }
      return { variant: v, base, current, next };
    });
  }, [variants, mode, percentInput, fixedByVariant, existingByVariant, priceRounding]);

  const canSaveProduct = useMemo(() => {
    if (!selectedProductId || variants.length === 0) return false;
    if (mode === 'percent') {
      const pct = Number(percentInput);
      return Number.isFinite(pct) && pct >= 1 && pct <= 100;
    }
    return previewRows.some((r) => r.next != null);
  }, [selectedProductId, variants.length, mode, percentInput, previewRows]);

  async function saveProductPrices(e: React.FormEvent) {
    e.preventDefault();
    if (!canSaveProduct) return;
    setProductSaving(true);
    setProductError(null);
    try {
      const toSave = previewRows.filter((r) => r.next != null) as Array<{
        variant: AdminVariant;
        next: number;
      }>;
      if (mode === 'fixed' && toSave.length === 0) {
        setProductError('Укажите цену хотя бы для одного варианта');
        return;
      }
      for (const row of toSave) {
        await adminBackendJson(
          `user-groups/admin/${groupId}/variant-prices/${row.variant.id}`,
          { method: 'PATCH', body: JSON.stringify({ price: row.next }) },
        );
      }
      showToast(
        toSave.length === 1
          ? 'Цена сохранена'
          : `Сохранено для ${toSave.length} вариантов`,
      );
      await loadList();
      onChanged();
      if (selectedProductId && selectedProductName) {
        await loadProduct(selectedProductId, selectedProductName);
      }
    } catch (err) {
      setProductError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось сохранить');
    } finally {
      setProductSaving(false);
    }
  }

  function clearProductForm() {
    setSelectedProductId(null);
    setSelectedProductName('');
    setProductDetail(null);
    setExistingByVariant(new Map());
    setFixedByVariant({});
    setPercentInput('10');
    setMode('percent');
    setProductError(null);
  }

  function startEditFromList(row: AdminGroupVariantPriceRow) {
    void loadProduct(row.productId, row.productName);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function confirmDeleteSku() {
    if (!deleteVariantId) return;
    setListSaving(true);
    setListError(null);
    try {
      await adminBackendJson(
        `user-groups/admin/${groupId}/variant-prices/${deleteVariantId}`,
        { method: 'DELETE' },
      );
      showToast('Цена удалена');
      setDeleteVariantId(null);
      setDeleteLabel('');
      await loadList();
      onChanged();
      if (productDetail?.variants.some((v) => v.id === deleteVariantId)) {
        setExistingByVariant((prev) => {
          const next = new Map(prev);
          next.delete(deleteVariantId);
          return next;
        });
      }
    } catch (err) {
      setListError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось удалить');
    } finally {
      setListSaving(false);
    }
  }

  return (
    <>
      {productError ? (
        <p className={catalogStyles.error} role="alert">
          {productError}
        </p>
      ) : null}
      {listError ? (
        <p className={catalogStyles.error} role="alert">
          {listError}
        </p>
      ) : null}

      <section className={settingsStyles.faqCard}>
        <div className={settingsStyles.faqCardHead}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className={settingsStyles.settingsEmptyTitle} style={{ margin: 0 }}>
              Цена для товара
            </p>
            <p className={catalogStyles.muted} style={{ margin: '4px 0 0' }}>
              Выберите один товар и задайте скидку или фиксированную цену для его вариантов. Базовая
              цена показана для ориентира.
            </p>
          </div>
          {selectedProductId ? (
            <AdminCompactBtn type="button" variant="outline" disabled={productSaving} onClick={clearProductForm}>
              Сменить товар
            </AdminCompactBtn>
          ) : null}
        </div>

        {!selectedProductId ? (
          <AdminCompactBtn type="button" variant="accent" onClick={() => setProductPickerOpen(true)}>
            Выбрать товар
          </AdminCompactBtn>
        ) : (
          <p className={catalogStyles.muted} style={{ margin: 0 }}>
            Товар:{' '}
            <Link href={`/admin/catalog/products/${selectedProductId}`} className={catalogStyles.link}>
              {selectedProductName}
            </Link>
          </p>
        )}

        {selectedProductId ? (
          <form className={settingsStyles.menuFormStack} onSubmit={(e) => void saveProductPrices(e)}>
            <AdminTabs
              ariaLabel="Тип цены товара"
              variant="pill"
              compact
              activeId={mode}
              onChange={(id) => setMode(id as ProductPriceMode)}
              items={[
                { id: 'percent', label: '−%' },
                { id: 'fixed', label: 'Фикс ₽' },
              ]}
            />
            {mode === 'percent' ? (
              <>
                <AdminTextField
                  label="Скидка, %"
                  value={percentInput}
                  onChange={(e) => setPercentInput(e.target.value)}
                  disabled={productSaving}
                  inputMode="numeric"
                />
                <p className={catalogStyles.muted} style={{ margin: 0 }}>
                  Применится ко всем вариантам товара
                </p>
              </>
            ) : null}
            {productLoading ? <p className={catalogStyles.muted}>Загрузка вариантов…</p> : null}
            {!productLoading && variants.length > 0 ? (
              <div className={catalogStyles.tableWrap}>
                <table className={catalogStyles.table}>
                  <thead>
                    <tr>
                      <th>Вариант</th>
                      <th>SKU</th>
                      <th>База</th>
                      <th>Сейчас в группе</th>
                      <th>{mode === 'percent' ? 'Будет' : 'Цена, ₽'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map(({ variant, base, current, next }) => (
                      <tr key={variant.id}>
                        <td>{variant.name}</td>
                        <td>{variant.sku || '—'}</td>
                        <td>{base} ₽</td>
                        <td>{current != null ? `${current} ₽` : '—'}</td>
                        <td>
                          {mode === 'percent' ? (
                            next != null ? `${next} ₽` : '—'
                          ) : (
                            <AdminTextField
                              label=""
                              aria-label={`Цена для ${variantRowKey(variant)}`}
                              value={fixedByVariant[variant.id] ?? ''}
                              onChange={(e) =>
                                setFixedByVariant((prev) => ({
                                  ...prev,
                                  [variant.id]: e.target.value,
                                }))
                              }
                              disabled={productSaving}
                              inputMode="numeric"
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {!productLoading && selectedProductId && variants.length === 0 ? (
              <p className={catalogStyles.muted}>У товара нет вариантов</p>
            ) : null}
            {variants.length > 0 ? (
              <div className={settingsStyles.menuProductActions}>
                <AdminCompactBtn type="submit" variant="accent" disabled={productSaving || !canSaveProduct}>
                  Сохранить
                </AdminCompactBtn>
              </div>
            ) : null}
          </form>
        ) : null}
      </section>

      <h2 className={catalogStyles.sectionTitle} style={{ marginTop: 24 }}>
        Сохранённые цены товаров
      </h2>
      {totalCount > PAGE_SIZE && !qDebounced ? (
        <p className={catalogStyles.muted}>
          В группе {totalCount} SKU-цен — список постранично ({PAGE_SIZE} на страницу).
        </p>
      ) : null}
      <div className={settingsStyles.menuProductActions} style={{ marginBottom: 12 }}>
        <div className={catalogStyles.searchBoxToolbar} style={{ flex: 1, minWidth: 200 }}>
          <AdminSearchBox
            placeholder="Поиск SKU или товара"
            ariaLabel="Поиск SKU-цен"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      {listLoading ? <p className={catalogStyles.muted}>Загрузка…</p> : null}
      <div className={catalogStyles.tableWrap}>
        <table className={catalogStyles.table}>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Товар</th>
              <th>База</th>
              <th>Группа</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!listLoading && items.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  {qDebounced ? (
                    <p className={catalogStyles.mutedInline}>Ничего не найдено</p>
                  ) : (
                    <div className={settingsStyles.settingsEmpty}>
                      <p className={settingsStyles.settingsEmptyTitle}>Групповых цен пока нет</p>
                      <p className={settingsStyles.settingsEmptyHint}>
                        Выберите товар выше и задайте скидку или фиксированную цену.
                      </p>
                      <AdminCompactBtn
                        type="button"
                        variant="accent"
                        onClick={() => setProductPickerOpen(true)}
                      >
                        Выбрать товар
                      </AdminCompactBtn>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.variantId}>
                  <td>{r.sku}</td>
                  <td>
                    <Link
                      href={`/admin/catalog/products/${r.productId}`}
                      className={catalogStyles.link}
                    >
                      {r.productName}
                    </Link>
                    {r.variantName ? (
                      <span className={catalogStyles.mutedInline}> · {r.variantName}</span>
                    ) : null}
                  </td>
                  <td>{r.basePrice} ₽</td>
                  <td>{r.price} ₽</td>
                  <td>
                    <div className={settingsStyles.menuProductActions}>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        disabled={listSaving}
                        onClick={() => startEditFromList(r)}
                      >
                        Изменить
                      </AdminCompactBtn>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        disabled={listSaving}
                        onClick={() => {
                          setDeleteVariantId(r.variantId);
                          setDeleteLabel(`${r.productName} · ${r.sku}`);
                        }}
                      >
                        Удалить
                      </AdminCompactBtn>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <AdminListPagination
        page={page}
        total={total}
        limit={PAGE_SIZE}
        onPageChange={setPage}
        disabled={listLoading || listSaving}
      />

      <DiscountProductPickerModal
        open={productPickerOpen}
        single
        selectedIds={selectedProductId ? [selectedProductId] : []}
        selectedLabels={selectedProductId ? { [selectedProductId]: selectedProductName } : {}}
        onClose={() => setProductPickerOpen(false)}
        onApply={(ids, labels) => {
          const id = ids[0];
          if (!id) return;
          void loadProduct(id, labels[id] ?? id);
        }}
      />
      <ConfirmDialog
        open={deleteVariantId != null}
        title="Удалить групповую цену?"
        message={`Сбросить групповую цену для ${deleteLabel || 'этого SKU'}? Будет использоваться база или правило категории.`}
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        danger
        onCancel={() => {
          setDeleteVariantId(null);
          setDeleteLabel('');
        }}
        onConfirm={() => void confirmDeleteSku()}
      />
    </>
  );
}
