'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import {
  AdminSortableTable,
  DragHandleCell,
} from '@/components/admin/AdminSortableTable/AdminSortableTable';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import { AdminSelect } from '@/components/AdminTextField/AdminTextField';
import { AdminConfirmDialog } from '@/components/admin/AdminModal/AdminConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime } from '@/lib/adminFormat';
import { useAdminPaginatedList } from '@/lib/useAdminPaginatedList';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import { BlogCategoriesPanel } from './BlogCategoriesPanel';
import type {
  AdminBlogCategoryRow,
  AdminBlogPostListItem,
} from './blogAdminTypes';

/** Согласовано с бэком `Math.min(..., 100)`; reorder только в пределах текущей страницы. */
const PAGE_LIMIT = 20;

type PublishedFilter = 'all' | 'published' | 'draft';

function parsePublishedFilter(raw: string | null): PublishedFilter {
  if (raw === 'published' || raw === 'draft') return raw;
  return 'all';
}

type ConfirmKind = 'delete' | 'bulk-delete';

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

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BlogListClient({ embedded = false }: { embedded?: boolean } = {}) {
  const { showToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [categoryId, setCategoryId] = useState(() => searchParams.get('categoryId') ?? '');
  const [published, setPublished] = useState<PublishedFilter>(() =>
    parsePublishedFilter(searchParams.get('published')),
  );
  const [categories, setCategories] = useState<AdminBlogCategoryRow[]>([]);
  const [displayItems, setDisplayItems] = useState<AdminBlogPostListItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: ConfirmKind;
    row?: AdminBlogPostListItem;
  } | null>(null);

  const initialQ = searchParams.get('q') ?? '';
  const initialPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const filterKey = `${categoryId}|${published}`;

  const buildPath = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) => {
      const sp = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (q) sp.set('q', q);
      if (categoryId) sp.set('categoryId', categoryId);
      if (published !== 'all') sp.set('published', published);
      return `blog/admin/posts?${sp}`;
    },
    [categoryId, published],
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
  } = useAdminPaginatedList<AdminBlogPostListItem>({
    buildPath,
    limit: PAGE_LIMIT,
    filterKey,
    initialQ,
    initialPage,
    errorFallback: 'Не удалось загрузить',
  });

  useEffect(() => {
    setDisplayItems(items);
  }, [items]);

  useEffect(() => {
    setSelected(new Set());
  }, [filterKey, qDebounced, page]);

  useEffect(() => {
    const sp = new URLSearchParams(searchParams.toString());
    if (qDebounced.trim()) sp.set('q', qDebounced.trim());
    else sp.delete('q');
    if (page > 1) sp.set('page', String(page));
    else sp.delete('page');
    if (published !== 'all') sp.set('published', published);
    else sp.delete('published');
    if (categoryId) sp.set('categoryId', categoryId);
    else sp.delete('categoryId');
    const next = sp.toString();
    const cur = searchParams.toString();
    if (next === cur) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [page, pathname, categoryId, qDebounced, router, searchParams, published]);

  const loadCategories = useCallback(async () => {
    try {
      const rows = await adminBackendJson<AdminBlogCategoryRow[]>('blog/admin/categories');
      setCategories(rows);
    } catch (e) {
      setCategories([]);
      showToast(
        e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить рубрики',
      );
    }
  }, [showToast]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      if (displayItems.length > 0 && displayItems.every((p) => prev.has(p.id))) {
        return new Set();
      }
      return new Set(displayItems.map((p) => p.id));
    });
  }

  async function revalidateBlog(slug?: string) {
    try {
      await fetch('/api/admin/revalidate-blog', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slug ? { slug } : {}),
      });
    } catch {
      /* ignore */
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    const kind = confirm.kind;
    const row = confirm.row;
    setConfirm(null);
    try {
      if (kind === 'delete' && row) {
        await adminBackendJson(`blog/admin/posts/${row.id}`, { method: 'DELETE' });
        await revalidateBlog(row.slug);
        showToast('Статья удалена');
        await reload();
      } else if (kind === 'bulk-delete') {
        setBulkBusy(true);
        const ids = [...selected];
        await adminBackendJson('blog/admin/posts/bulk-delete', {
          method: 'POST',
          body: JSON.stringify({ ids }),
        });
        await revalidateBlog();
        showToast(ids.length === 1 ? 'Статья удалена' : `Удалено: ${ids.length}`);
        await reload();
      }
    } catch (e) {
      showToast(e instanceof AdminBackendRequestError ? e.message : 'Не удалось удалить');
    } finally {
      setBulkBusy(false);
    }
  }

  async function togglePublished(row: AdminBlogPostListItem) {
    setBusyId(row.id);
    try {
      const nextPublished = !row.isPublished;
      await adminBackendJson(`blog/admin/posts/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: nextPublished }),
      });
      await revalidateBlog(row.slug);
      showToast(nextPublished ? 'Статья опубликована' : 'Статья в черновике');
      await reload();
    } catch (e) {
      showToast(
        e instanceof AdminBackendRequestError ? e.message : 'Не удалось изменить статус',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function reorder(orderedIds: string[]) {
    const prev = displayItems;
    setDisplayItems((cur) => {
      const map = new Map(cur.map((p) => [p.id, p]));
      return orderedIds.map((id) => map.get(id)!).filter(Boolean);
    });
    try {
      await adminBackendJson('blog/admin/posts/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
      });
    } catch (e) {
      setDisplayItems(prev);
      showToast(
        e instanceof AdminBackendRequestError ? e.message : 'Не удалось сохранить порядок',
      );
    }
  }

  const allOnPageSelected =
    displayItems.length > 0 && displayItems.every((p) => selected.has(p.id));

  const emptyLabel = searching ? 'Ничего не найдено' : 'Статей пока нет';

  const confirmCopy =
    confirm?.kind === 'bulk-delete'
      ? {
          title: `Удалить выбранные (${selected.size})?`,
          message: 'Статьи будут удалены безвозвратно.',
          confirmLabel: 'Удалить',
        }
      : {
          title: 'Удалить статью?',
          message: confirm?.row ? `«${confirm.row.title}» будет удалена безвозвратно.` : '',
          confirmLabel: 'Удалить',
        };

  return (
    <>
      {embedded ? null : <h1 className={catalogStyles.title}>Блог</h1>}

      <BlogCategoriesPanel
        categories={categories}
        onChanged={() => {
          void loadCategories();
          void reload();
        }}
      />

      <AdminListShell
        loading={loading}
        error={error}
        onRetry={() => void reload()}
        loadingLabel="Загрузка…"
        empty={emptyLabel}
        isEmpty={!loading && displayItems.length === 0}
        isFetching={fetching}
        toolbar={
          <div className={catalogStyles.toolbar}>
            <div className={catalogStyles.toolbarLeft}>
              <div className={catalogStyles.searchBoxToolbar}>
                <AdminSearchBox
                  ariaLabel="Поиск статей"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Поиск…"
                />
              </div>
              <AdminCompactBtnLink href="/admin/blog/new" variant="accent">
                Новая статья
              </AdminCompactBtnLink>
              <AdminSelect
                label="Рубрика"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setPage(1);
                }}
                className={catalogStyles.toolbarFilter}
              >
                <option value="">Все</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </AdminSelect>
              <AdminSelect
                label="Статус"
                value={published}
                onChange={(e) => {
                  setPublished(e.target.value as PublishedFilter);
                  setPage(1);
                }}
                className={catalogStyles.toolbarFilter}
              >
                <option value="all">Все</option>
                <option value="published">Опубликовано</option>
                <option value="draft">Черновик</option>
              </AdminSelect>
              {selected.size > 0 ? (
                <AdminCompactBtn
                  type="button"
                  variant="danger"
                  disabled={bulkBusy}
                  onClick={() => setConfirm({ kind: 'bulk-delete' })}
                >
                  Удалить выбранные ({selected.size})
                </AdminCompactBtn>
              ) : null}
            </div>
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
        <AdminSortableTable
          ids={displayItems.map((p) => p.id)}
          onReorder={reorder}
          head={
            <tr>
              <th style={{ width: 36 }}>
                <AdminCheckbox
                  className={catalogStyles.adminCheckboxInTable}
                  checked={allOnPageSelected}
                  onChange={toggleAllOnPage}
                  aria-label="Выбрать все на странице"
                />
              </th>
              <th style={{ width: 36 }} aria-label="Порядок" />
              <th>Заголовок</th>
              <th>Рубрика</th>
              <th>Статус</th>
              <th>Дата</th>
              <th />
            </tr>
          }
          renderRow={(id, drag) => {
            const row = displayItems.find((x) => x.id === id)!;
            return (
              <>
                <td>
                  <AdminCheckbox
                    className={catalogStyles.adminCheckboxInTable}
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    aria-label={`Выбрать «${row.title}»`}
                  />
                </td>
                <DragHandleCell {...drag} />
                <td>
                  <Link href={`/admin/blog/${row.id}`}>{row.title}</Link>
                  {row.isPublished ? (
                    <>
                      {' '}
                      <a
                        href={`/blog/${encodeURIComponent(row.slug)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={catalogStyles.mutedInline}
                      >
                        ↗
                      </a>
                    </>
                  ) : null}
                </td>
                <td className={catalogStyles.mutedInline}>{row.category?.name ?? '—'}</td>
                <td>
                  <span
                    className={`${catalogStyles.badge} ${
                      row.isPublished ? catalogStyles.badgeOn : catalogStyles.badgeDraft
                    }`}
                  >
                    {row.isPublished ? 'Опубликовано' : 'Черновик'}
                  </span>
                </td>
                <td className={catalogStyles.mutedInline}>
                  {row.publishedAt ? formatAdminDateTime(row.publishedAt) : '—'}
                </td>
                <td className={catalogStyles.tableCellActions}>
                  <div className={catalogStyles.actionGroup}>
                    <AdminCompactBtn
                      type="button"
                      variant={row.isPublished ? 'outline' : 'accent'}
                      disabled={busyId === row.id || bulkBusy}
                      onClick={() => void togglePublished(row)}
                    >
                      {row.isPublished ? 'В черновик' : 'Опубликовать'}
                    </AdminCompactBtn>
                    <AdminCompactBtnLink
                      href={`/admin/blog/${row.id}`}
                      variant="outline"
                      className={catalogStyles.iconBtn}
                      aria-label={`Изменить «${row.title}»`}
                      title="Изменить"
                    >
                      <EditIcon />
                    </AdminCompactBtnLink>
                    <AdminCompactBtn
                      type="button"
                      variant="danger"
                      className={catalogStyles.iconDangerBtn}
                      disabled={busyId === row.id || bulkBusy}
                      onClick={() => setConfirm({ kind: 'delete', row })}
                      aria-label={`Удалить «${row.title}»`}
                      title="Удалить"
                    >
                      <TrashIcon />
                    </AdminCompactBtn>
                  </div>
                </td>
              </>
            );
          }}
        />
      </AdminListShell>

      <AdminConfirmDialog
        open={confirm != null}
        title={confirmCopy.title}
        message={confirmCopy.message}
        confirmLabel={confirmCopy.confirmLabel}
        danger
        onConfirm={() => void runConfirm()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
