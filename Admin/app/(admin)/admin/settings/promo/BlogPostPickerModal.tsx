'use client';

import { useEffect, useState } from 'react';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type { AdminBlogPostListItem, AdminBlogPostsListResponse } from '@/app/(admin)/admin/blog/blogAdminTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

const PAGE_SIZE = 50;

export function BlogPostPickerModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (post: { id: string; slug: string; title: string }) => void;
}) {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminBlogPostListItem[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    setDraftId(null);
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
          published: 'published',
        });
        if (qDebounced.trim()) sp.set('q', qDebounced.trim());
        const res = await adminBackendJson<AdminBlogPostsListResponse>(
          `blog/admin/posts?${sp}`,
        );
        if (cancelled) return;
        setRows(res.items);
        setTotal(res.total);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof AdminBackendRequestError
              ? e.status === 403
                ? 'Нет доступа к блогу. Нужен раздел «Блог» у модератора.'
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

  function apply() {
    const row = rows.find((r) => r.id === draftId);
    if (!row) return;
    onPick({ id: row.id, slug: row.slug, title: row.title });
    onClose();
  }

  return (
    <AdminModal
      open={open}
      title="Статья"
      wide
      onClose={onClose}
      footer={
        <AdminModalActions
          onCancel={onClose}
          onConfirm={apply}
          confirmDisabled={!draftId}
        />
      }
    >
      <AdminSearchBox
        placeholder="Поиск статьи"
        ariaLabel="Поиск статьи"
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
                  <th>Статья</th>
                  <th>Путь</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="radio"
                        name="promo-article-single"
                        className={styles.adminCheckboxInTable}
                        checked={draftId === r.id}
                        onChange={() => setDraftId(r.id)}
                        aria-label={r.title}
                      />
                    </td>
                    <td>{r.title}</td>
                    <td className={styles.mutedInline}>/articles/{r.slug}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && rows.length === 0 ? (
              <p className={styles.muted}>
                {qDebounced.trim() ? 'Ничего не найдено' : 'Нет опубликованных статей'}
              </p>
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
