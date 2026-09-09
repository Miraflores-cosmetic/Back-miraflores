'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type {
  AdminCatalogVisibilityRule,
  AdminGroupCategoryPriceRow,
  AdminGroupVariantPriceRow,
  AdminUserGroup,
} from '@/lib/adminUserGroupTypes';
import { UserGroupMembersTab } from '../UserGroupMembersTab';
import {
  DiscountProductPickerModal,
  UserGroupLeafCategoryPickerModal,
  UserGroupVariantPickerModal,
} from '../UserGroupPickers';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

type TabId = 'general' | 'members' | 'prices' | 'categories' | 'visibility';

const VISIBILITY_MODE_LABELS: Record<string, string> = {
  HIDE_FROM_GUESTS: 'Скрыть от гостей',
  HIDE_FROM_REGISTERED: 'Скрыть от зарег.',
  HIDE_FROM_GROUP: 'Скрыть от группы',
  SHOW_ONLY_REGISTERED: 'Только зарег.',
  SHOW_ONLY_GROUP: 'Только группа',
};

const VISIBILITY_TARGET_LABELS: Record<string, string> = {
  PRODUCT: 'Товар',
  CATEGORY: 'Категория',
  VARIANT: 'Вариант',
};

export function UserGroupDetailClient({ groupId }: { groupId: string }) {
  const [tab, setTab] = useState<TabId>('general');
  const [group, setGroup] = useState<AdminUserGroup | null>(null);
  const [variantPrices, setVariantPrices] = useState<AdminGroupVariantPriceRow[]>([]);
  const [categoryPrices, setCategoryPrices] = useState<AdminGroupCategoryPriceRow[]>([]);
  const [visibility, setVisibility] = useState<AdminCatalogVisibilityRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedVariantLabel, setSelectedVariantLabel] = useState('');
  const [variantPickerOpen, setVariantPickerOpen] = useState(false);
  const [priceInput, setPriceInput] = useState('');

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedCategoryLabel, setSelectedCategoryLabel] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [catType, setCatType] = useState<'PERCENT_OFF' | 'FIXED_OFF' | 'FIXED_PRICE'>('PERCENT_OFF');
  const [catValue, setCatValue] = useState('10');

  const [visMode, setVisMode] = useState<
    | 'HIDE_FROM_GUESTS'
    | 'HIDE_FROM_REGISTERED'
    | 'HIDE_FROM_GROUP'
    | 'SHOW_ONLY_REGISTERED'
    | 'SHOW_ONLY_GROUP'
  >('HIDE_FROM_GROUP');
  const [visTargetType, setVisTargetType] = useState<'PRODUCT' | 'CATEGORY' | 'VARIANT'>('PRODUCT');
  const [visTargetId, setVisTargetId] = useState<string | null>(null);
  const [visTargetLabel, setVisTargetLabel] = useState('');
  const [visProductPickerOpen, setVisProductPickerOpen] = useState(false);
  const [visCategoryPickerOpen, setVisCategoryPickerOpen] = useState(false);
  const [visVariantPickerOpen, setVisVariantPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [g, vp, cp, vis] = await Promise.all([
        adminBackendJson<AdminUserGroup>(`user-groups/admin/${groupId}`),
        adminBackendJson<{ items: AdminGroupVariantPriceRow[] }>(
          `user-groups/admin/${groupId}/variant-prices?limit=50`,
        ),
        adminBackendJson<{ items: AdminGroupCategoryPriceRow[] }>(
          `user-groups/admin/${groupId}/category-prices`,
        ),
        adminBackendJson<{ items: AdminCatalogVisibilityRule[] }>(
          `user-groups/admin/${groupId}/visibility`,
        ),
      ]);
      setGroup(g);
      setVariantPrices(vp.items);
      setCategoryPrices(cp.items);
      setVisibility(vis.items);
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveGeneral(patch: Partial<AdminUserGroup>) {
    if (!group) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await adminBackendJson<AdminUserGroup>(`user-groups/admin/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setGroup(updated);
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  async function addSkuPrice(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(priceInput);
    if (!selectedVariantId || !Number.isFinite(price)) return;
    setSaving(true);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/variant-prices/${selectedVariantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ price: Math.floor(price) }),
      });
      setSelectedVariantId(null);
      setSelectedVariantLabel('');
      setPriceInput('');
      await load();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось добавить цену');
    } finally {
      setSaving(false);
    }
  }

  async function addVisibilityRule(e: React.FormEvent) {
    e.preventDefault();
    if (!visTargetId) return;
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/visibility`, {
        method: 'POST',
        body: JSON.stringify({
          mode: visMode,
          targetType: visTargetType,
          targetId: visTargetId,
        }),
      });
      setVisTargetId(null);
      setVisTargetLabel('');
      await load();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось добавить правило');
    } finally {
      setSaving(false);
    }
  }

  async function deleteVisibilityRule(ruleId: string) {
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/visibility/${ruleId}`, {
        method: 'DELETE',
      });
      await load();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось удалить');
    } finally {
      setSaving(false);
    }
  }

  async function addCategoryPrice(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(catValue);
    if (!selectedCategoryId || !Number.isFinite(value)) return;
    setSaving(true);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/category-prices/${selectedCategoryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ type: catType, value: Math.floor(value) }),
      });
      setSelectedCategoryId(null);
      setSelectedCategoryLabel('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить правило');
    } finally {
      setSaving(false);
    }
  }

  function openVisibilityTargetPicker() {
    if (visTargetType === 'PRODUCT') setVisProductPickerOpen(true);
    else if (visTargetType === 'CATEGORY') setVisCategoryPickerOpen(true);
    else setVisVariantPickerOpen(true);
  }

  if (loading) return <p className={styles.muted}>Загрузка…</p>;
  if (!group) return <p className={styles.error}>{error ?? 'Группа не найдена'}</p>;

  const tabItems = [
    { id: 'general', label: 'Общее' },
    ...(group.assignable ? [{ id: 'members', label: `Участники (${group.counts.users})` }] : []),
    { id: 'prices', label: 'Цены SKU' },
    { id: 'categories', label: 'Категории' },
    { id: 'visibility', label: 'Видимость' },
  ];

  return (
    <>
      <AdminCompactBtnLink href="/admin/user-groups">← Группы</AdminCompactBtnLink>
      <h1 className={styles.title}>{group.name}</h1>
      <p className={styles.lead}>
        slug: {group.slug}
        {group.isDefaultGuest ? ' · системная (гости)' : ''}
        {group.isDefaultRegistered ? ' · системная (розница зарег.)' : ''}
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}

      <AdminTabs
        ariaLabel="Раздел группы"
        variant="underline"
        activeId={tab}
        onChange={(id) => setTab(id as TabId)}
        items={tabItems}
      />

      {tab === 'general' ? (
        <div className={styles.formBlock}>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={group.allowCatalogDiscounts}
              disabled={saving}
              onChange={(e) => void saveGeneral({ allowCatalogDiscounts: e.target.checked })}
            />{' '}
            Кампании Discount (каталожные акции)
          </label>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={group.allowPromoCodes}
              disabled={saving}
              onChange={(e) => void saveGeneral({ allowPromoCodes: e.target.checked })}
            />{' '}
            Промокоды на checkout
          </label>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={group.active}
              disabled={saving || group.isDefaultGuest || group.isDefaultRegistered}
              onChange={(e) => void saveGeneral({ active: e.target.checked })}
            />{' '}
            Активна
            {group.isDefaultGuest || group.isDefaultRegistered ? (
              <span className={styles.muted}> (системная — нельзя деактивировать)</span>
            ) : null}
          </label>
          <p className={styles.muted}>
            slug: <code>{group.slug}</code>
            {group.isDefaultGuest || group.isDefaultRegistered ? (
              <> — системный, менять нельзя</>
            ) : null}
          </p>
          <p className={styles.muted}>
            Участников: {group.counts.users} · SKU-цен: {group.counts.variantPrices} · правил
            категорий: {group.counts.categoryPrices}
          </p>
        </div>
      ) : null}

      {tab === 'members' ? (
        <UserGroupMembersTab groupId={groupId} assignable={group.assignable} />
      ) : null}

      {tab === 'prices' ? (
        <>
          <form className={styles.inlineForm} onSubmit={addSkuPrice}>
            <AdminCompactBtn type="button" onClick={() => setVariantPickerOpen(true)}>
              {selectedVariantLabel || 'Выбрать вариант'}
            </AdminCompactBtn>
            <input
              className={styles.input}
              placeholder="Цена ₽"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
            />
            <AdminCompactBtn type="submit" disabled={saving || !selectedVariantId}>
              Добавить
            </AdminCompactBtn>
          </form>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Товар</th>
                <th>Base</th>
                <th>Группа</th>
              </tr>
            </thead>
            <tbody>
              {variantPrices.map((r) => (
                <tr key={r.variantId}>
                  <td>{r.sku}</td>
                  <td>{r.productName}</td>
                  <td>{r.basePrice} ₽</td>
                  <td>{r.price} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
          <UserGroupVariantPickerModal
            open={variantPickerOpen}
            selectedId={selectedVariantId}
            onClose={() => setVariantPickerOpen(false)}
            onApply={(id, label) => {
              setSelectedVariantId(id);
              setSelectedVariantLabel(label);
            }}
          />
        </>
      ) : null}

      {tab === 'categories' ? (
        <>
          <form className={styles.inlineForm} onSubmit={addCategoryPrice}>
            <AdminCompactBtn type="button" onClick={() => setCategoryPickerOpen(true)}>
              {selectedCategoryLabel || 'Выбрать категорию'}
            </AdminCompactBtn>
            <select
              className={styles.input}
              value={catType}
              onChange={(e) => setCatType(e.target.value as typeof catType)}
            >
              <option value="PERCENT_OFF">−%</option>
              <option value="FIXED_OFF">−₽</option>
              <option value="FIXED_PRICE">Фикс ₽</option>
            </select>
            <input
              className={styles.input}
              value={catValue}
              onChange={(e) => setCatValue(e.target.value)}
            />
            <AdminCompactBtn type="submit" disabled={saving || !selectedCategoryId}>
              Сохранить
            </AdminCompactBtn>
          </form>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Категория</th>
                <th>Тип</th>
                <th>Значение</th>
              </tr>
            </thead>
            <tbody>
              {categoryPrices.map((r) => (
                <tr key={r.categoryId}>
                  <td>{r.categoryName}</td>
                  <td>{r.type}</td>
                  <td>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <UserGroupLeafCategoryPickerModal
            open={categoryPickerOpen}
            selectedId={selectedCategoryId}
            onClose={() => setCategoryPickerOpen(false)}
            onApply={(id, label) => {
              setSelectedCategoryId(id);
              setSelectedCategoryLabel(label);
            }}
          />
        </>
      ) : null}

      {tab === 'visibility' ? (
        <>
          <p className={styles.muted}>
            Правила с привязкой к этой группе. CRUD — секция «Пользователи».
          </p>
          <form className={styles.inlineForm} onSubmit={addVisibilityRule}>
            <select
              className={styles.input}
              value={visMode}
              onChange={(e) => setVisMode(e.target.value as typeof visMode)}
            >
              {Object.entries(VISIBILITY_MODE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className={styles.input}
              value={visTargetType}
              onChange={(e) => {
                setVisTargetType(e.target.value as typeof visTargetType);
                setVisTargetId(null);
                setVisTargetLabel('');
              }}
            >
              {Object.entries(VISIBILITY_TARGET_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <AdminCompactBtn type="button" onClick={openVisibilityTargetPicker}>
              {visTargetLabel || 'Выбрать цель'}
            </AdminCompactBtn>
            <AdminCompactBtn type="submit" disabled={saving || !visTargetId}>
              Добавить
            </AdminCompactBtn>
          </form>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Режим</th>
                <th>Цель</th>
                <th>Объект</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibility.map((r) => (
                <tr key={r.id}>
                  <td>{VISIBILITY_MODE_LABELS[r.mode] ?? r.mode}</td>
                  <td>{VISIBILITY_TARGET_LABELS[r.targetType] ?? r.targetType}</td>
                  <td>{r.targetLabel ?? r.targetId}</td>
                  <td>
                    <AdminCompactBtn
                      type="button"
                      disabled={saving}
                      onClick={() => void deleteVisibilityRule(r.id)}
                    >
                      Удалить
                    </AdminCompactBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <DiscountProductPickerModal
            open={visProductPickerOpen}
            single
            selectedIds={visTargetId ? [visTargetId] : []}
            selectedLabels={visTargetId && visTargetLabel ? { [visTargetId]: visTargetLabel } : {}}
            onClose={() => setVisProductPickerOpen(false)}
            onApply={(ids, labels) => {
              const id = ids[0];
              if (!id) return;
              setVisTargetId(id);
              setVisTargetLabel(labels[id] ?? id);
            }}
          />
          <UserGroupLeafCategoryPickerModal
            open={visCategoryPickerOpen}
            selectedId={visTargetId}
            onClose={() => setVisCategoryPickerOpen(false)}
            onApply={(id, label) => {
              setVisTargetId(id);
              setVisTargetLabel(label);
            }}
          />
          <UserGroupVariantPickerModal
            open={visVariantPickerOpen}
            selectedId={visTargetId}
            onClose={() => setVisVariantPickerOpen(false)}
            onApply={(id, label) => {
              setVisTargetId(id);
              setVisTargetLabel(label);
            }}
          />
        </>
      ) : null}
    </>
  );
}
