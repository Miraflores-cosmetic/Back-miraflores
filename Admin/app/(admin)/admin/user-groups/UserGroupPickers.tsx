'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type {
  AdminCategory,
  AdminProduct,
  AdminProductListItem,
  AdminProductListResponse,
} from '@/lib/adminCatalogTypes';
import type { AdminRetailUser, AdminRetailUserListResponse } from '@/lib/adminUserTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

export {
  DiscountCategoryPickerModal,
  DiscountProductPickerModal,
} from '@/app/(admin)/admin/discounts/DiscountScopePickerModal';

const PAGE_SIZE = 50;

function categoryLabel(c: AdminCategory): string {
  if (c.parent?.name) return `${c.parent.name} → ${c.name}`;
  return c.name;
}

/** Leaf categories only (для group category prices). */
export function UserGroupLeafCategoryPickerModal({
  open,
  selectedId,
  onClose,
  onApply,
}: {
  open: boolean;
  selectedId: string | null;
  onClose: () => void;
  onApply: (id: string, label: string) => void;
}) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminCategory[]>([]);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(selectedId);
    setQ('');
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const cats = await adminBackendJson<AdminCategory[]>('catalog/admin/categories');
        if (cancelled) return;
        const parentIds = new Set(
          cats.map((c) => c.parentId).filter((id): id is string => Boolean(id)),
        );
        const leaves = cats.filter((c) => !parentIds.has(c.id));
        setRows(
          leaves.slice().sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), 'ru')),
        );
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof AdminBackendRequestError
              ? e.status === 403
                ? 'Нет доступа к каталогу'
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
  }, [open, selectedId]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((c) => categoryLabel(c).toLowerCase().includes(term));
  }, [rows, q]);

  function apply() {
    if (!draft) return;
    const cat = rows.find((c) => c.id === draft);
    if (!cat) return;
    onApply(cat.id, categoryLabel(cat));
    onClose();
  }

  return (
    <AdminModal
      open={open}
      title="Категория (leaf)"
      wide
      onClose={onClose}
      footer={
        <AdminModalActions
          onCancel={onClose}
          onConfirm={apply}
          confirmDisabled={!draft}
        />
      }
    >
      <p className={styles.muted}>Только конечные категории без подкатегорий.</p>
      <AdminSearchBox
        placeholder="Поиск категории"
        ariaLabel="Поиск категории"
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
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th>Категория</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="radio"
                      name="ug-leaf-category"
                      checked={draft === c.id}
                      onChange={() => setDraft(c.id)}
                      aria-label={categoryLabel(c)}
                    />
                  </td>
                  <td>{categoryLabel(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? <p className={styles.muted}>Ничего не найдено</p> : null}
        </div>
      ) : null}
    </AdminModal>
  );
}

export function UserGroupVariantPickerModal({
  open,
  selectedId,
  onClose,
  onApply,
}: {
  open: boolean;
  selectedId: string | null;
  onClose: () => void;
  onApply: (variantId: string, label: string) => void;
}) {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<AdminProductListItem[]>([]);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [variants, setVariants] = useState<AdminProduct['variants']>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    setDraft(selectedId);
    setDraftLabel('');
    setQ('');
    setQDebounced('');
    setPage(1);
    setExpandedProductId(null);
    setVariants([]);
  }, [open, selectedId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
          visibility: 'all',
        });
        if (qDebounced.trim()) sp.set('q', qDebounced.trim());
        const res = await adminBackendJson<AdminProductListResponse>(
          `catalog/admin/products?${sp}`,
        );
        if (cancelled) return;
        setProducts(res.items);
        setTotal(res.total);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof AdminBackendRequestError
              ? e.status === 403
                ? 'Нет доступа к каталогу'
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
  }, [open, qDebounced, page]);

  async function expandProduct(productId: string) {
    if (expandedProductId === productId) {
      setExpandedProductId(null);
      setVariants([]);
      return;
    }
    setExpandedProductId(productId);
    setVariantsLoading(true);
    try {
      const p = await adminBackendJson<AdminProduct>(`catalog/admin/products/${productId}`);
      setVariants(p.variants.filter((v) => v.active));
    } catch {
      setVariants([]);
    } finally {
      setVariantsLoading(false);
    }
  }

  function pickVariant(variantId: string, label: string) {
    setDraft(variantId);
    setDraftLabel(label);
  }

  function apply() {
    if (!draft) return;
    onApply(draft, draftLabel || draft);
    onClose();
  }

  return (
    <AdminModal
      open={open}
      title="Вариант (SKU)"
      wide
      onClose={onClose}
      footer={
        <AdminModalActions
          onCancel={onClose}
          onConfirm={apply}
          confirmDisabled={!draft}
        />
      }
    >
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
      {!error ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Товар</th>
                  <th>SKU</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <Fragment key={p.id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className={styles.link}
                          onClick={() => void expandProduct(p.id)}
                          aria-expanded={expandedProductId === p.id}
                        >
                          {expandedProductId === p.id ? '▼' : '▶'}
                        </button>
                      </td>
                      <td>{p.name}</td>
                      <td className={styles.mutedInline}>{p.primarySku ?? '—'}</td>
                    </tr>
                    {expandedProductId === p.id ? (
                      <tr>
                        <td colSpan={3}>
                          {variantsLoading ? (
                            <p className={styles.muted}>Варианты…</p>
                          ) : variants.length ? (
                            <table className={styles.table}>
                              <tbody>
                                {variants.map((v) => {
                                  const label = `${p.name} · ${v.name} (${v.sku})`;
                                  return (
                                    <tr key={v.id}>
                                      <td style={{ width: 40 }}>
                                        <input
                                          type="radio"
                                          name="ug-variant"
                                          checked={draft === v.id}
                                          onChange={() => pickVariant(v.id, label)}
                                          aria-label={label}
                                        />
                                      </td>
                                      <td>{v.name}</td>
                                      <td>
                                        {v.sku} · {v.price} ₽
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <p className={styles.muted}>Нет активных вариантов</p>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {!loading && products.length === 0 ? (
              <p className={styles.muted}>Ничего не найдено</p>
            ) : null}
          </div>
          <AdminListPagination
            page={page}
            total={total}
            limit={PAGE_SIZE}
            onPageChange={setPage}
            disabled={loading}
          />
        </>
      ) : null}
    </AdminModal>
  );
}

export function UserGroupMemberPickerModal({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (userId: string, label: string) => void;
}) {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminRetailUser[]>([]);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    setDraft(null);
    setQ('');
    setQDebounced('');
    setPage(1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
        });
        if (qDebounced.trim()) sp.set('q', qDebounced.trim());
        const res = await adminBackendJson<AdminRetailUserListResponse>(
          `users/admin?${sp}`,
        );
        if (cancelled) return;
        setRows(res.items);
        setTotal(res.total);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, qDebounced, page]);

  function userLabel(u: AdminRetailUser): string {
    return u.displayName?.trim() || u.email;
  }

  function apply() {
    if (!draft) return;
    const u = rows.find((r) => r.id === draft);
    if (!u) return;
    onApply(u.id, userLabel(u));
    onClose();
  }

  return (
    <AdminModal
      open={open}
      title="Добавить участника"
      wide
      onClose={onClose}
      footer={
        <AdminModalActions
          onCancel={onClose}
          onConfirm={apply}
          confirmDisabled={!draft}
        />
      }
    >
      <AdminSearchBox
        placeholder="Email или имя"
        ariaLabel="Поиск пользователя"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {loading ? <p className={styles.muted}>Загрузка…</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {!error ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Имя</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <input
                        type="radio"
                        name="ug-member"
                        checked={draft === u.id}
                        onChange={() => setDraft(u.id)}
                        aria-label={userLabel(u)}
                      />
                    </td>
                    <td>{u.displayName?.trim() || '—'}</td>
                    <td>{u.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && rows.length === 0 ? (
              <p className={styles.muted}>Ничего не найдено</p>
            ) : null}
          </div>
          <AdminListPagination
            page={page}
            total={total}
            limit={PAGE_SIZE}
            onPageChange={setPage}
            disabled={loading}
          />
        </>
      ) : null}
    </AdminModal>
  );
}
