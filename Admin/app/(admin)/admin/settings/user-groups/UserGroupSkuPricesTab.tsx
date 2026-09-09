'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { USER_GROUP_PRICE_STACK_HINT } from '@/lib/userGroupAdminUi';
import type {
  AdminGroupVariantPriceListResponse,
  AdminGroupVariantPriceRow,
} from '@/lib/adminUserGroupTypes';
import { VariantPickerModal } from '@/app/(admin)/admin/settings/gratitude/VariantPickerModal';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import settingsStyles from '@/app/(admin)/admin/settings/Settings.module.css';

const PAGE_SIZE = 25;

export function UserGroupSkuPricesTab({
  groupId,
  totalCount,
  onPricesChanged,
}: {
  groupId: string;
  totalCount: number;
  onPricesChanged: () => void;
}) {
  const { showToast } = useToast();
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(totalCount);
  const [items, setItems] = useState<AdminGroupVariantPriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedVariantLabel, setSelectedVariantLabel] = useState('');
  const [variantPickerOpen, setVariantPickerOpen] = useState(false);
  const [priceInput, setPriceInput] = useState('');

  const [deleteVariantId, setDeleteVariantId] = useState<string | null>(null);
  const [deleteLabel, setDeleteLabel] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [groupId, page, qDebounced]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upsertSkuPrice(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(priceInput);
    if (!selectedVariantId || !Number.isFinite(price)) return;
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/variant-prices/${selectedVariantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ price: Math.floor(price) }),
      });
      setSelectedVariantId(null);
      setSelectedVariantLabel('');
      setPriceInput('');
      showToast('Цена сохранена');
      await load();
      onPricesChanged();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  function startEditSku(row: AdminGroupVariantPriceRow) {
    setSelectedVariantId(row.variantId);
    setSelectedVariantLabel(`${row.productName} · ${row.variantName} (${row.sku})`);
    setPriceInput(String(row.price));
  }

  async function confirmDeleteSku() {
    if (!deleteVariantId) return;
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(
        `user-groups/admin/${groupId}/variant-prices/${deleteVariantId}`,
        { method: 'DELETE' },
      );
      showToast('Цена удалена');
      setDeleteVariantId(null);
      setDeleteLabel('');
      await load();
      onPricesChanged();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось удалить');
    } finally {
      setSaving(false);
    }
  }

  const editingExisting =
    selectedVariantId != null && items.some((r) => r.variantId === selectedVariantId);

  return (
    <>
      {error ? (
        <p className={catalogStyles.error} role="alert">
          {error}
        </p>
      ) : null}
      <p className={catalogStyles.muted} style={{ margin: '0 0 12px' }}>
        {USER_GROUP_PRICE_STACK_HINT}
      </p>
      {totalCount > PAGE_SIZE && !qDebounced ? (
        <p className={catalogStyles.muted}>
          В группе {totalCount} SKU-цен — список постранично ({PAGE_SIZE} на страницу).
        </p>
      ) : null}
      <section className={settingsStyles.faqCard}>
        <form className={settingsStyles.menuFormStack} onSubmit={(e) => void upsertSkuPrice(e)}>
          <AdminCompactBtn type="button" variant="outline" onClick={() => setVariantPickerOpen(true)}>
            {selectedVariantLabel || 'Выбрать вариант'}
          </AdminCompactBtn>
          <AdminTextField
            label="Цена для группы, ₽"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            disabled={saving}
            inputMode="numeric"
          />
          <div className={settingsStyles.menuProductActions}>
            <AdminCompactBtn type="submit" variant="accent" disabled={saving || !selectedVariantId}>
              {editingExisting ? 'Обновить' : 'Добавить'}
            </AdminCompactBtn>
            {selectedVariantId ? (
              <AdminCompactBtn
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setSelectedVariantId(null);
                  setSelectedVariantLabel('');
                  setPriceInput('');
                }}
              >
                Сбросить форму
              </AdminCompactBtn>
            ) : null}
          </div>
        </form>
      </section>
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
      {loading ? <p className={catalogStyles.muted}>Загрузка…</p> : null}
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
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  {qDebounced ? (
                    <p className={catalogStyles.mutedInline}>Ничего не найдено</p>
                  ) : (
                    <div className={settingsStyles.settingsEmpty}>
                      <p className={settingsStyles.settingsEmptyTitle}>Групповых цен пока нет</p>
                      <p className={settingsStyles.settingsEmptyHint}>
                        Задайте фиксированную цену для SKU — она имеет наивысший приоритет в стеке
                        расчёта.
                      </p>
                      <AdminCompactBtn
                        type="button"
                        variant="accent"
                        disabled={saving}
                        onClick={() => setVariantPickerOpen(true)}
                      >
                        Добавить первую цену
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
                        disabled={saving}
                        onClick={() => startEditSku(r)}
                      >
                        Изменить
                      </AdminCompactBtn>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        disabled={saving}
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
        disabled={loading || saving}
      />
      <VariantPickerModal
        open={variantPickerOpen}
        selectedVariantId={selectedVariantId ?? ''}
        selectedLabel={selectedVariantLabel}
        onClose={() => setVariantPickerOpen(false)}
        onApply={(id, label) => {
          setSelectedVariantId(id);
          setSelectedVariantLabel(label);
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
