'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import { AdminSelect } from '@/components/AdminTextField/AdminTextField';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type {
  AdminCategory,
  AdminProductListItem,
} from '@/lib/adminCatalogTypes';
import { adminBackendListAllPages } from '@/lib/adminListAll';
import { formatAdminMoney } from '@/lib/adminFormat';
import { revalidateCatalogStorefront } from '@/lib/revalidateCatalogStorefront';
import { useAdminPaginatedList } from '@/lib/useAdminPaginatedList';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

type Visibility = 'all' | 'catalog' | 'hidden' | 'excluded';
type CollectionPick = { id: string; name: string };

const LIMIT = 50;

function parseVisibility(raw: string | null): Visibility {
  if (raw === 'catalog' || raw === 'hidden' || raw === 'excluded' || raw === 'all') return raw;
  return 'all';
}

function productStatusLabel(p: AdminProductListItem): string {
  if (!p.active) return 'Выключен';
  if (p.excludeFromCatalog) return 'Не в каталоге';
  return 'В каталоге';
}

function productStatusOn(p: AdminProductListItem): boolean {
  return p.active && !p.excludeFromCatalog;
}

function categoryLabel(p: AdminProductListItem): string {
  const c = p.category;
  if (!c) return '—';
  if (c.parent?.name) return `${c.parent.name} → ${c.name}`;
  return c.name;
}

function categoryOptionLabel(c: AdminCategory): string {
  if (c.parent?.name) return `${c.parent.name} → ${c.name}`;
  return c.name;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ProductsListClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [visibility, setVisibility] = useState<Visibility>(() =>
    parseVisibility(searchParams.get('visibility')),
  );
  const [categoryId, setCategoryId] = useState(() => searchParams.get('categoryId') ?? '');
  const [collectionId, setCollectionId] = useState(
    () => searchParams.get('collectionId') ?? '',
  );
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [collections, setCollections] = useState<CollectionPick[]>([]);
  const [pendingDelete, setPendingDelete] = useState<AdminProductListItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const initialQ = searchParams.get('q') ?? '';
  const initialPage = Math.max(1, Number(searchParams.get('page')) || 1);

  const filterKey = `${visibility}|${categoryId}|${collectionId}`;

  const buildPath = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) => {
      const sp = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        visibility,
      });
      if (q) sp.set('q', q);
      if (categoryId) sp.set('categoryId', categoryId);
      if (collectionId) sp.set('collectionId', collectionId);
      return `catalog/admin/products?${sp}`;
    },
    [categoryId, collectionId, visibility],
  );

  const {
    q,
    setQ,
    qDebounced,
    page,
    setPage,
    loading,
    fetching,
    error,
    items,
    total,
    dataPage,
    dataLimit,
    reload,
    searching,
  } = useAdminPaginatedList<AdminProductListItem>({
    buildPath,
    limit: LIMIT,
    filterKey,
    initialQ,
    initialPage,
    errorFallback: 'Не удалось загрузить товары',
  });

  useEffect(() => {
    const sp = new URLSearchParams();
    if (visibility !== 'all') sp.set('visibility', visibility);
    if (categoryId) sp.set('categoryId', categoryId);
    if (collectionId) sp.set('collectionId', collectionId);
    if (qDebounced.trim()) sp.set('q', qDebounced.trim());
    if (page > 1) sp.set('page', String(page));
    const next = sp.toString();
    const cur = searchParams.toString();
    if (next === cur) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [
    categoryId,
    collectionId,
    page,
    pathname,
    qDebounced,
    router,
    searchParams,
    visibility,
  ]);

  useEffect(() => {
    void (async () => {
      try {
        const [cats, cols] = await Promise.all([
          adminBackendJson<AdminCategory[]>('catalog/admin/categories'),
          adminBackendListAllPages<CollectionPick>('catalog/admin/collections'),
        ]);
        setCategories(
          cats
            .slice()
            .sort(
              (a, b) =>
                (a.parent?.name ?? a.name).localeCompare(b.parent?.name ?? b.name, 'ru') ||
                a.name.localeCompare(b.name, 'ru'),
            ),
        );
        setCollections(
          cols
            .map((c) => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        );
      } catch {
        setCategories([]);
        setCollections([]);
      }
    })();
  }, []);

  const categoryOptions = useMemo(
    () =>
      categories.map((c) => ({
        value: c.id,
        label: categoryOptionLabel(c),
      })),
    [categories],
  );

  async function deleteProductConfirmed() {
    const p = pendingDelete;
    if (!p || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await adminBackendJson(`catalog/admin/products/${p.id}`, { method: 'DELETE' });
      setPendingDelete(null);
      await reload();
      await revalidateCatalogStorefront({ productSlug: p.slug });
    } catch (e) {
      alert(e instanceof AdminBackendRequestError ? e.message : 'Не удалось удалить товар');
    } finally {
      setDeleteBusy(false);
    }
  }

  const emptyLabel = searching
    ? 'Ничего не найдено'
    : collectionId
      ? 'В этой коллекции нет товаров'
      : categoryId
        ? 'В этой категории нет товаров'
        : 'Товаров пока нет';

  return (
    <>
      <h1 className={styles.title}>Товары</h1>

      <AdminTabs
        ariaLabel="Фильтр видимости"
        variant="underline"
        activeId={visibility}
        onChange={(id) => {
          setVisibility(id as Visibility);
          setPage(1);
        }}
        items={[
          { id: 'all', label: 'Все' },
          { id: 'catalog', label: 'В каталоге' },
          { id: 'excluded', label: 'Не в каталоге' },
          { id: 'hidden', label: 'Выключенные' },
        ]}
      />

      <AdminListShell
        loading={loading}
        error={error}
        onRetry={() => void reload()}
        loadingLabel="Загрузка…"
        empty={emptyLabel}
        isEmpty={!loading && items.length === 0}
        isFetching={fetching}
        toolbar={
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <div className={styles.searchBoxToolbar}>
                <AdminSearchBox
                  placeholder="Поиск по названию / SKU"
                  ariaLabel="Поиск товаров"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <AdminSelect
                label="Категория"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setPage(1);
                }}
                className={styles.toolbarFilter}
              >
                <option value="">Все категории</option>
                {categoryOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </AdminSelect>
              <AdminSelect
                label="Коллекция"
                value={collectionId}
                onChange={(e) => {
                  setCollectionId(e.target.value);
                  setPage(1);
                }}
                className={styles.toolbarFilter}
              >
                <option value="">Все коллекции</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </AdminSelect>
            </div>
            <AdminCompactBtnLink href="/admin/catalog/products/new" variant="accent">
              Добавить товар
            </AdminCompactBtnLink>
          </div>
        }
        pagination={
          !loading && !error ? (
            <AdminListPagination
              page={dataPage}
              total={total}
              limit={dataLimit}
              onPageChange={setPage}
              disabled={fetching}
            />
          ) : null
        }
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 88 }} aria-label="Фото" />
              <th>Название</th>
              <th>Категория</th>
              <th>Варианты</th>
              <th>Сток</th>
              <th>от, ₽</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className={productStatusOn(p) ? undefined : styles.rowInactive}>
                <td>
                  {p.coverImageUrl && p.coverMediaType !== 'video' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className={styles.productListThumb} src={p.coverImageUrl} alt="" />
                  ) : p.coverMediaType === 'video' && p.coverImageUrl ? (
                    <span className={styles.productListThumbVideo} title="Видео-обложка">
                      Видео
                    </span>
                  ) : (
                    <span className={styles.productListThumbPh} aria-hidden />
                  )}
                </td>
                <td>
                  <Link
                    href={`/admin/catalog/products/${p.id}`}
                    className={styles.productListName}
                    title={p.name}
                  >
                    {p.name}
                  </Link>
                </td>
                <td>{categoryLabel(p)}</td>
                <td>{p.variantCount}</td>
                <td>{p.stockTotal}</td>
                <td>{p.minPrice != null ? formatAdminMoney(p.minPrice) : '—'}</td>
                <td>
                  <span
                    className={`${styles.badge} ${productStatusOn(p) ? styles.badgeOn : styles.badgeOff}`}
                  >
                    {productStatusLabel(p)}
                  </span>
                </td>
                <td className={styles.tableCellActions}>
                  <AdminCompactBtn
                    type="button"
                    variant="danger"
                    className={styles.iconDangerBtn}
                    onClick={() => setPendingDelete(p)}
                    aria-label={`Удалить товар «${p.name}»`}
                    title="Удалить"
                  >
                    <TrashIcon />
                  </AdminCompactBtn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminListShell>

      <ConfirmDialog
        open={pendingDelete != null}
        title="Удалить товар?"
        message={
          pendingDelete
            ? `Товар «${pendingDelete.name}» и все его варианты будут удалены. Если товар есть в заказах — удаление будет отклонено, скройте его.`
            : ''
        }
        confirmLabel={deleteBusy ? 'Удаляем…' : 'Удалить'}
        danger
        confirmDisabled={deleteBusy}
        onConfirm={() => void deleteProductConfirmed()}
        onCancel={() => {
          if (!deleteBusy) setPendingDelete(null);
        }}
      />
    </>
  );
}
