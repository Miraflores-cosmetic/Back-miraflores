'use client';

import { useEffect, useMemo, useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
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
  excludeIds = [],
}: {
  open: boolean;
  selectedIds: string[];
  onClose: () => void;
  onApply: (ids: string[], labels: Record<string, string>) => void;
  /** Один выбор (radio) вместо чекбоксов. */
  single?: boolean;
  /** Только конечные категории (без подкатегорий). */
  leafOnly?: boolean;
  /** Скрыть из списка (например, уже есть правило). Редактируемые selectedIds не исключаются снаружи. */
  excludeIds?: string[];
}) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminCategory[]>([]);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  useEffect(() => {
    if (!open) return;
    const allowed = selectedIds.filter((id) => !excludeSet.has(id));
    setDraft(new Set(single ? allowed.slice(0, 1) : allowed));
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
  }, [open, selectedIds, single, excludeSet]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term
      ? rows.filter((c) => categoryLabel(c).toLowerCase().includes(term))
      : rows;
    // Уже занятые правилом — не показываем в списке (не disabled-строки).
    return base.filter((c) => !excludeSet.has(c.id));
  }, [rows, q, excludeSet]);

  const selectableFiltered = filtered;

  function toggle(id: string) {
    if (excludeSet.has(id)) return;
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

  const title = leafOnly
    ? single
      ? 'Конечная категория'
      : 'Конечные категории'
    : 'Категории';
  const hint = leafOnly
    ? 'Только категории без подкатегорий (конечные в дереве каталога).'
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
          confirmDisabled={draft.size === 0}
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
      {!loading && !error && !single && selectableFiltered.length > 0 ? (
        <div className={styles.toolbarRow} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <AdminCompactBtn
            type="button"
            variant="outline"
            onClick={() => setDraft(new Set(selectableFiltered.map((c) => c.id)))}
          >
            Выбрать все ({selectableFiltered.length})
          </AdminCompactBtn>
          <AdminCompactBtn type="button" variant="outline" onClick={() => setDraft(new Set())}>
            Снять выбор
          </AdminCompactBtn>
        </div>
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
          {filtered.length === 0 ? (
            <p className={styles.muted}>
              {q.trim()
                ? 'Ничего не найдено'
                : excludeSet.size > 0 && rows.length > 0
                  ? 'Свободных категорий нет — у всех уже есть правила'
                  : 'Ничего не найдено'}
            </p>
          ) : null}
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
  excludeIds = [],
}: {
  open: boolean;
  selectedIds: string[];
  selectedLabels: Record<string, string>;
  onClose: () => void;
  onApply: (ids: string[], labels: Record<string, string>) => void;
  single?: boolean;
  /** Нельзя выбрать (например, уже есть групповая цена). */
  excludeIds?: string[];
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
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const allowed = selectedIds.filter((id) => !excludeSet.has(id));
    setDraft(new Set(single ? allowed.slice(0, 1) : allowed));
    setLabels({ ...selectedLabels });
    setQ('');
    setQDebounced('');
    setPage(1);
  }, [open, selectedIds, selectedLabels, single, excludeSet]);

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

  const visibleRows = useMemo(
    () => rows.filter((p) => !excludeSet.has(p.id)),
    [rows, excludeSet],
  );

  function toggle(id: string, name: string) {
    if (excludeSet.has(id)) return;
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
                {visibleRows.map((p) => (
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
            {!loading && visibleRows.length === 0 ? (
              <p className={styles.muted}>
                {qDebounced.trim()
                  ? 'Ничего не найдено'
                  : excludeSet.size > 0 && rows.length > 0
                    ? 'Свободных товаров нет — у всех на странице уже есть цены'
                    : 'Ничего не найдено'}
              </p>
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
