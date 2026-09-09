'use client';

import { useCallback, useEffect, useState } from 'react';
import { DiscountCategoryPickerModal } from '@/app/(admin)/admin/discounts/DiscountScopePickerModal';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type { AdminGroupCategoryPriceRow } from '@/lib/adminUserGroupTypes';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import settingsStyles from '@/app/(admin)/admin/settings/Settings.module.css';

/** Пагинация списка — отложена; до этого порога показываем всё на одной странице. */
const CATEGORY_LIST_SOFT_LIMIT = 50;

const CATEGORY_TYPE_LABELS: Record<string, string> = {
  PERCENT_OFF: '−%',
  FIXED_OFF: '−₽',
  FIXED_PRICE: 'Фикс ₽',
};

type CatType = 'PERCENT_OFF' | 'FIXED_OFF' | 'FIXED_PRICE';

type Props = {
  groupId: string;
  onChanged?: () => void;
};

export function UserGroupCategoryPricesTab({ groupId, onChanged }: Props) {
  const { showToast } = useToast();
  const [items, setItems] = useState<AdminGroupCategoryPriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedCategoryLabel, setSelectedCategoryLabel] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [catType, setCatType] = useState<CatType>('PERCENT_OFF');
  const [catValue, setCatValue] = useState('10');
  const [deleteRow, setDeleteRow] = useState<AdminGroupCategoryPriceRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminBackendJson<{ items: AdminGroupCategoryPriceRow[] }>(
        `user-groups/admin/${groupId}/category-prices`,
      );
      setItems(res.items);
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upsertCategoryPrice(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(catValue);
    if (!selectedCategoryId || !Number.isFinite(value)) return;
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/category-prices/${selectedCategoryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ type: catType, value: Math.floor(value) }),
      });
      setSelectedCategoryId(null);
      setSelectedCategoryLabel('');
      showToast('Правило категории сохранено');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить правило');
    } finally {
      setSaving(false);
    }
  }

  function startEditCategory(row: AdminGroupCategoryPriceRow) {
    setSelectedCategoryId(row.categoryId);
    setSelectedCategoryLabel(row.categoryName);
    setCatType(row.type);
    setCatValue(String(row.value));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearForm() {
    setSelectedCategoryId(null);
    setSelectedCategoryLabel('');
    setCatType('PERCENT_OFF');
    setCatValue('10');
  }

  async function confirmDeleteCategory() {
    if (!deleteRow) return;
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(
        `user-groups/admin/${groupId}/category-prices/${deleteRow.categoryId}`,
        { method: 'DELETE' },
      );
      showToast('Правило категории удалено');
      setDeleteRow(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось удалить');
    } finally {
      setSaving(false);
    }
  }

  const editingExisting =
    selectedCategoryId != null && items.some((r) => r.categoryId === selectedCategoryId);

  return (
    <>
      {error ? (
        <p className={catalogStyles.error} role="alert">
          {error}
        </p>
      ) : null}

      <section className={settingsStyles.faqCard}>
        <div className={settingsStyles.faqCardHead}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className={settingsStyles.settingsEmptyTitle} style={{ margin: 0 }}>
              {editingExisting ? 'Изменить правило' : 'Новое правило'}
            </p>
            <p className={catalogStyles.muted} style={{ margin: '4px 0 0' }}>
              Только конечные категории без подкатегорий. На витрине правило наследуется вниз; при
              расчёте берётся ближайшее правило вверх по дереву.
            </p>
          </div>
          {selectedCategoryId ? (
            <AdminCompactBtn type="button" variant="outline" disabled={saving} onClick={clearForm}>
              Сбросить
            </AdminCompactBtn>
          ) : null}
        </div>

        <form className={settingsStyles.menuFormStack} onSubmit={(e) => void upsertCategoryPrice(e)}>
          <AdminCompactBtn type="button" variant="outline" onClick={() => setCategoryPickerOpen(true)}>
            {selectedCategoryLabel || 'Выбрать категорию'}
          </AdminCompactBtn>

          <AdminTabs
            ariaLabel="Тип правила категории"
            variant="pill"
            compact
            activeId={catType}
            onChange={(id) => setCatType(id as CatType)}
            items={[
              { id: 'PERCENT_OFF', label: '−%' },
              { id: 'FIXED_OFF', label: '−₽' },
              { id: 'FIXED_PRICE', label: 'Фикс ₽' },
            ]}
          />

          <AdminTextField
            label={catType === 'PERCENT_OFF' ? 'Скидка, %' : catType === 'FIXED_OFF' ? 'Скидка, ₽' : 'Цена, ₽'}
            value={catValue}
            onChange={(e) => setCatValue(e.target.value)}
            disabled={saving}
            inputMode="numeric"
          />

          <div className={settingsStyles.menuProductActions}>
            <AdminCompactBtn type="submit" variant="accent" disabled={saving || !selectedCategoryId}>
              {editingExisting ? 'Обновить' : 'Сохранить'}
            </AdminCompactBtn>
          </div>
        </form>
      </section>

      <h2 className={catalogStyles.sectionTitle} style={{ marginTop: 24 }}>
        Сохранённые правила
      </h2>
      {items.length > CATEGORY_LIST_SOFT_LIMIT ? (
        <p className={catalogStyles.muted}>
          {items.length} правил — список без пагинации (пока комфортно до ~{CATEGORY_LIST_SOFT_LIMIT}).
        </p>
      ) : null}
      {loading ? <p className={catalogStyles.muted}>Загрузка…</p> : null}
      <div className={catalogStyles.tableWrap}>
        <table className={catalogStyles.table}>
          <thead>
            <tr>
              <th>Категория</th>
              <th>Тип</th>
              <th>Значение</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className={settingsStyles.settingsEmpty}>
                    <p className={settingsStyles.settingsEmptyTitle}>Правил категорий пока нет</p>
                    <p className={settingsStyles.settingsEmptyHint}>
                      Выберите конечную категорию и задайте скидку или фиксированную цену.
                    </p>
                    <AdminCompactBtn
                      type="button"
                      variant="accent"
                      disabled={saving}
                      onClick={() => setCategoryPickerOpen(true)}
                    >
                      Добавить первое правило
                    </AdminCompactBtn>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.categoryId}>
                  <td>{r.categoryName}</td>
                  <td>{CATEGORY_TYPE_LABELS[r.type] ?? r.type}</td>
                  <td>
                    {r.type === 'PERCENT_OFF' ? `${r.value}%` : `${r.value} ₽`}
                  </td>
                  <td>
                    <div className={settingsStyles.menuProductActions}>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => startEditCategory(r)}
                      >
                        Изменить
                      </AdminCompactBtn>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => setDeleteRow(r)}
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

      <DiscountCategoryPickerModal
        open={categoryPickerOpen}
        single
        leafOnly
        selectedIds={selectedCategoryId ? [selectedCategoryId] : []}
        onClose={() => setCategoryPickerOpen(false)}
        onApply={(ids, labels) => {
          const id = ids[0];
          if (!id) return;
          setSelectedCategoryId(id);
          setSelectedCategoryLabel(labels[id] ?? id);
        }}
      />
      <ConfirmDialog
        open={deleteRow != null}
        title="Удалить правило категории?"
        message={
          deleteRow
            ? `Сбросить ценовое правило для «${deleteRow.categoryName}»? На витрине снова будет база или SKU-цена.`
            : ''
        }
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        danger
        onCancel={() => setDeleteRow(null)}
        onConfirm={() => void confirmDeleteCategory()}
      />
    </>
  );
}
