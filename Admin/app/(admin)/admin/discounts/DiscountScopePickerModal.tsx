'use client';

import { useEffect, useMemo, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type { AdminCategory, AdminProductListItem, AdminProductListResponse } from '@/lib/adminCatalogTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import { DISCOUNT_CATEGORY_NO_DESCENDANTS_HINT } from './discountHints';

const PRODUCT_PAGE_SIZE = 50;

function categoryLabel(c: AdminCategory): string {
  if (c.parent?.name) return `${c.parent.name} → ${c.name}`;
  return c.name;
}

export function DiscountCategoryPickerModal({
  open,
  selectedIds,
  onClose,
  onApply,
  single = false,
  leafOnly = false,
}: {
  open: boolean;
  selectedIds: string[];
  onClose: () => void;
  onApply: (ids: string[], labels: Record<string, string>) => void;
  /** Один выбор (radio) вместо чекбоксов. */
  single?: boolean;
  /** Только leaf-категории без подкатегорий. */
  leafOnly?: boolean;
}) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminCategory[]>([]);
  const [draft, setDraft] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(single ? selectedIds.slice(0, 1) : selectedIds));
    setQ('');
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const cats = await adminBackendJson<AdminCategory[]>('catalog/admin/categories');
        if (cancelled) return;
        let list = cats;
        if (leafOnly) {
          const parentIds = new Set(
            cats.map((c) => c.parentId).filter((id): id is string => Boolean(id)),
          );
          list = cats.filter((c) => !parentIds.has(c.id));
        }
        setRows(
          list.slice().sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), 'ru')),
        );
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof AdminBackendRequestError
              ? e.status === 403
                ? 'Нет доступа к каталогу. Нужен раздел «Каталог» у модератора.'
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
  }, [open, selectedIds, single]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((c) => categoryLabel(c).toLowerCase().includes(term));
  }, [rows, q]);

  function toggle(id: string) {
    setDraft((prev) => {
      if (single) {
        return prev.has(id) ? new Set() : new Set([id]);
      }
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function apply() {
    const labels: Record<string, string> = {};
    for (const c of rows) {
      if (draft.has(c.id)) labels[c.id] = categoryLabel(c);
    }
    onApply([...draft], labels);
    onClose();
  }

  const title =
    leafOnly && single ? 'Категория (leaf)' : leafOnly ? 'Категории (leaf)' : 'Категории';
  const hint = leafOnly
    ? 'Только конечные категории без подкатегорий.'
    : DISCOUNT_CATEGORY_NO_DESCENDANTS_HINT;

  return (
    <AdminModal
      open={open}
      title={title}
      wide
      onClose={onClose}
      footer={
        <AdminModalActions
          onCancel={onClose}
          onConfirm={apply}
          confirmDisabled={single && draft.size === 0}
        />
      }
    >
      <p className={styles.muted}>{hint}</p>
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
                    {single ? (
                      <input
                        type="radio"
                        name="admin-category-single"
                        className={styles.adminCheckboxInTable}
                        checked={draft.has(c.id)}
                        onChange={() => toggle(c.id)}
                        aria-label={categoryLabel(c)}
                      />
                    ) : (
                      <AdminCheckbox
                        className={styles.adminCheckboxInTable}
                        checked={draft.has(c.id)}
                        onChange={() => toggle(c.id)}
                        aria-label={categoryLabel(c)}
                      />
                    )}
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

export function DiscountProductPickerModal({
  open,
  selectedIds,
  selectedLabels,
  onClose,
  onApply,
  /** Один товар вместо чекбоксов. */
  single = false,
}: {
  open: boolean;
  selectedIds: string[];
  selectedLabels: Record<string, string>;
  onClose: () => void;
  onApply: (ids: string[], labels: Record<string, string>) => void;
  single?: boolean;
}) {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminProductListItem[]>([]);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(single ? selectedIds.slice(0, 1) : selectedIds));
    setLabels({ ...selectedLabels });
    setQ('');
    setQDebounced('');
    setPage(1);
  }, [open, selectedIds, selectedLabels, single]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams({
          page: String(page),
          limit: String(PRODUCT_PAGE_SIZE),
          visibility: 'all',
        });
        if (qDebounced.trim()) sp.set('q', qDebounced.trim());
        const res = await adminBackendJson<AdminProductListResponse>(
          `catalog/admin/products?${sp}`,
        );
        if (cancelled) return;
        setRows(res.items);
        setTotal(res.total);
        setLabels((prev) => {
          const next = { ...prev };
          for (const p of res.items) next[p.id] = p.name;
          return next;
        });
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof AdminBackendRequestError
              ? e.status === 403
                ? 'Нет доступа к каталогу. Нужен раздел «Каталог» у модератора.'
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

  function toggle(id: string, name: string) {
    setDraft((prev) => {
      if (single) {
        return prev.has(id) ? new Set() : new Set([id]);
      }
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLabels((prev) => ({ ...prev, [id]: name }));
  }

  function apply() {
    const outLabels: Record<string, string> = {};
    for (const id of draft) outLabels[id] = labels[id] ?? id;
    onApply([...draft], outLabels);
    onClose();
  }

  return (
    <AdminModal
      open={open}
      title={single ? 'Товар' : 'Товары'}
      wide
      onClose={onClose}
      footer={<AdminModalActions onCancel={onClose} onConfirm={apply} />}
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
                  <th>Категория</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {single ? (
                        <input
                          type="radio"
                          name="admin-product-single"
                          className={styles.adminCheckboxInTable}
                          checked={draft.has(p.id)}
                          onChange={() => toggle(p.id, p.name)}
                          aria-label={p.name}
                        />
                      ) : (
                        <AdminCheckbox
                          className={styles.adminCheckboxInTable}
                          checked={draft.has(p.id)}
                          onChange={() => toggle(p.id, p.name)}
                          aria-label={p.name}
                        />
                      )}
                    </td>
                    <td>{p.name}</td>
                    <td className={styles.mutedInline}>{p.category?.name ?? '—'}</td>
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
            limit={PRODUCT_PAGE_SIZE}
            onPageChange={setPage}
            disabled={loading}
          />
        </>
      ) : null}
    </AdminModal>
  );
}
