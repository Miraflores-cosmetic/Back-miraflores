'use client';

import { useCallback, useEffect, useState } from 'react';
import { DiscountCategoryPickerModal } from '@/app/(admin)/admin/discounts/DiscountScopePickerModal';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminPillChip, AdminPillChipList } from '@/components/AdminPillChip/AdminPillChip';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type { AdminGroupCategoryPriceRow } from '@/lib/adminUserGroupTypes';
import { fetchLeafCategories } from '@/lib/userGroupPricing';
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

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedCategoryLabels, setSelectedCategoryLabels] = useState<Record<string, string>>({});
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

  async function saveCategoryPrices(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(catValue);
    if (!selectedCategoryIds.length || !Number.isFinite(value)) return;
    const count = selectedCategoryIds.length;
    const flooredValue = Math.floor(value);
    setSaving(true);
    setError(null);
    try {
      if (count === 1) {
        await adminBackendJson(
          `user-groups/admin/${groupId}/category-prices/${selectedCategoryIds[0]}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ type: catType, value: flooredValue }),
          },
        );
      } else {
        await adminBackendJson(`user-groups/admin/${groupId}/category-prices/bulk`, {
          method: 'POST',
          body: JSON.stringify({
            items: selectedCategoryIds.map((categoryId) => ({
              categoryId,
              type: catType,
              value: flooredValue,
            })),
          }),
        });
      }

      setSelectedCategoryIds([]);
      setSelectedCategoryLabels({});
      showToast(
        count === 1 ? 'Правило категории сохранено' : `Сохранено для ${count} категорий`,
      );
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить правило');
    } finally {
      setSaving(false);
    }
  }

  async function selectAllLeafCategories() {
    setSaving(true);
    setError(null);
    try {
      const leaves = await fetchLeafCategories();
      const labels = Object.fromEntries(leaves.map((c) => [c.id, c.label]));
      setSelectedCategoryIds(leaves.map((c) => c.id));
      setSelectedCategoryLabels(labels);
      showToast(`Выбрано ${leaves.length} leaf-категорий`);
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить категории');
    } finally {
      setSaving(false);
    }
  }

  function startEditCategory(row: AdminGroupCategoryPriceRow) {
    setSelectedCategoryIds([row.categoryId]);
    setSelectedCategoryLabels({ [row.categoryId]: row.categoryName });
    setCatType(row.type);
    setCatValue(String(row.value));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearForm() {
    setSelectedCategoryIds([]);
    setSelectedCategoryLabels({});
    setCatType('PERCENT_OFF');
    setCatValue('10');
  }

  function removeCategory(categoryId: string) {
    setSelectedCategoryIds((prev) => prev.filter((id) => id !== categoryId));
    setSelectedCategoryLabels((prev) => {
      const next = { ...prev };
      delete next[categoryId];
      return next;
    });
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
    selectedCategoryIds.length === 1 &&
    items.some((r) => r.categoryId === selectedCategoryIds[0]);

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
              Только конечные категории без подкатегорий. Можно выбрать несколько или сразу все
              leaf-категории. На витрине правило наследуется вниз; при расчёте берётся ближайшее
              правило вверх по дереву.
            </p>
          </div>
          {selectedCategoryIds.length ? (
            <AdminCompactBtn type="button" variant="outline" disabled={saving} onClick={clearForm}>
              Сбросить
            </AdminCompactBtn>
          ) : null}
        </div>

        <form className={settingsStyles.menuFormStack} onSubmit={(e) => void saveCategoryPrices(e)}>
          <div className={settingsStyles.menuProductActions}>
            <AdminCompactBtn
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setCategoryPickerOpen(true)}
            >
              {selectedCategoryIds.length ? 'Изменить выбор' : 'Выбрать категории'}
            </AdminCompactBtn>
            <AdminCompactBtn
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => void selectAllLeafCategories()}
            >
              Все leaf-категории
            </AdminCompactBtn>
          </div>

          {selectedCategoryIds.length > 0 ? (
            <AdminPillChipList aria-label="Выбранные категории">
              {selectedCategoryIds.map((id) => (
                <AdminPillChip
                  key={id}
                  onRemove={() => removeCategory(id)}
                  removeAriaLabel={`Убрать ${selectedCategoryLabels[id] ?? 'категорию'}`}
                >
                  {selectedCategoryLabels[id] ?? id}
                </AdminPillChip>
              ))}
            </AdminPillChipList>
          ) : null}

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
            label={
              catType === 'PERCENT_OFF'
                ? 'Скидка, %'
                : catType === 'FIXED_OFF'
                  ? 'Скидка, ₽'
                  : 'Цена, ₽'
            }
            value={catValue}
            onChange={(e) => setCatValue(e.target.value)}
            disabled={saving}
            inputMode="numeric"
          />

          <div className={settingsStyles.menuProductActions}>
            <AdminCompactBtn
              type="submit"
              variant="accent"
              disabled={saving || selectedCategoryIds.length === 0}
            >
              {editingExisting
                ? 'Обновить'
                : selectedCategoryIds.length > 1
                  ? `Сохранить для ${selectedCategoryIds.length} категорий`
                  : 'Сохранить'}
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
                      Выберите категории или нажмите «Все leaf-категории», задайте скидку и сохраните.
                    </p>
                    <div className={settingsStyles.menuProductActions}>
                      <AdminCompactBtn
                        type="button"
                        variant="accent"
                        disabled={saving}
                        onClick={() => void selectAllLeafCategories()}
                      >
                        Все leaf-категории
                      </AdminCompactBtn>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => setCategoryPickerOpen(true)}
                      >
                        Выбрать категории
                      </AdminCompactBtn>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.categoryId}>
                  <td>{r.categoryName}</td>
                  <td>{CATEGORY_TYPE_LABELS[r.type] ?? r.type}</td>
                  <td>{r.type === 'PERCENT_OFF' ? `${r.value}%` : `${r.value} ₽`}</td>
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
        leafOnly
        selectedIds={selectedCategoryIds}
        onClose={() => setCategoryPickerOpen(false)}
        onApply={(ids, labels) => {
          setSelectedCategoryIds(ids);
          setSelectedCategoryLabels(labels);
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
