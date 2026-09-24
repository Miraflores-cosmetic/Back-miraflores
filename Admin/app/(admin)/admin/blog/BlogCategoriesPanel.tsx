'use client';

import { useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import {
  AdminSortableTable,
  DragHandleCell,
} from '@/components/admin/AdminSortableTable/AdminSortableTable';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { AdminConfirmDialog } from '@/components/admin/AdminModal/AdminConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import type { AdminBlogCategoryRow } from './blogAdminTypes';
import blogStyles from './blogAdmin.module.css';

const STORAGE_KEY = 'admin-blog-categories-open';

function readOpenState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* ignore */
  }
  return false;
}

type Props = {
  categories: AdminBlogCategoryRow[];
  onChanged: () => void;
};

export function BlogCategoriesPanel({ categories, onChanged }: Props) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(readOpenState);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminBlogCategoryRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function createCategory() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      await adminBackendJson('blog/admin/categories', {
        method: 'POST',
        body: JSON.stringify({ name: n }),
      });
      setName('');
      onChanged();
    } catch (e) {
      const msg =
        e instanceof AdminBackendRequestError || e instanceof Error
          ? e.message
          : 'Не удалось создать';
      setError(msg);
      showToast(msg);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(cat: AdminBlogCategoryRow) {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditSlug(cat.slug);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    const n = editName.trim();
    if (!n) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const payload: { name: string; slug?: string } = { name: n };
      const s = editSlug.trim();
      if (s) payload.slug = s;
      await adminBackendJson(`blog/admin/categories/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setEditingId(null);
      showToast('Рубрика сохранена');
      onChanged();
    } catch (e) {
      const msg =
        e instanceof AdminBackendRequestError || e instanceof Error
          ? e.message
          : 'Не удалось сохранить';
      setEditError(msg);
      showToast(msg);
    } finally {
      setEditBusy(false);
    }
  }

  function requestDelete(cat: AdminBlogCategoryRow) {
    if ((cat.postCount ?? 0) > 0) {
      showToast('Нельзя удалить категорию со статьями');
      return;
    }
    setPendingDelete(cat);
  }

  async function confirmDelete() {
    const cat = pendingDelete;
    setPendingDelete(null);
    if (!cat) return;
    setDeleteBusy(true);
    try {
      await adminBackendJson(`blog/admin/categories/${cat.id}`, { method: 'DELETE' });
      showToast('Рубрика удалена');
      onChanged();
    } catch (e) {
      showToast(
        e instanceof AdminBackendRequestError ? e.message : 'Не удалось удалить',
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  async function reorder(orderedIds: string[]) {
    try {
      await adminBackendJson('blog/admin/categories/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
      });
      onChanged();
    } catch (e) {
      showToast(
        e instanceof AdminBackendRequestError ? e.message : 'Не удалось сохранить порядок',
      );
      onChanged();
    }
  }

  return (
    <div className={blogStyles.categoriesPanel}>
      <button
        type="button"
        className={blogStyles.categoriesHeader}
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span className={blogStyles.categoriesTitle}>Рубрики ({categories.length})</span>
        <span className={blogStyles.categoriesHeaderMeta}>
          <span className={blogStyles.categoriesChevron} data-open={open || undefined} aria-hidden>
            ▾
          </span>
          <span className={catalogStyles.mutedInline}>{open ? 'Скрыть' : 'Показать'}</span>
        </span>
      </button>
      {open ? (
        <>
          <div className={blogStyles.categoriesRow}>
            <AdminTextField
              label="Новая рубрика"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Название"
            />
            <AdminCompactBtn
              type="button"
              variant="accent"
              disabled={busy || !name.trim()}
              onClick={() => void createCategory()}
            >
              Добавить
            </AdminCompactBtn>
          </div>
          {error ? (
            <p className={catalogStyles.error} role="alert">
              {error}
            </p>
          ) : null}
          {categories.length === 0 ? (
            <p className={catalogStyles.muted}>Рубрик пока нет</p>
          ) : (
            <AdminSortableTable
              ids={categories.map((c) => c.id)}
              onReorder={reorder}
              head={
                <tr>
                  <th style={{ width: 36 }} aria-label="Порядок" />
                  <th>Название</th>
                  <th>Slug</th>
                  <th>Статей</th>
                  <th />
                </tr>
              }
              renderRow={(id, drag) => {
                const c = categories.find((x) => x.id === id)!;
                if (editingId === c.id) {
                  return (
                    <>
                      <DragHandleCell {...drag} />
                      <td colSpan={2}>
                        <div className={blogStyles.categoriesRow}>
                          <AdminTextField
                            label="Название"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <AdminTextField
                            label="Slug"
                            value={editSlug}
                            onChange={(e) => setEditSlug(e.target.value)}
                            placeholder="необязательно"
                          />
                        </div>
                        {editError ? (
                          <p className={catalogStyles.error} role="alert">
                            {editError}
                          </p>
                        ) : null}
                      </td>
                      <td className={catalogStyles.mutedInline}>{c.postCount ?? 0}</td>
                      <td className={catalogStyles.tableCellActions}>
                        <AdminCompactBtn
                          type="button"
                          variant="accent"
                          disabled={editBusy || !editName.trim()}
                          onClick={() => void saveEdit()}
                        >
                          Сохранить
                        </AdminCompactBtn>
                        <AdminCompactBtn
                          type="button"
                          variant="outline"
                          disabled={editBusy}
                          onClick={cancelEdit}
                        >
                          Отмена
                        </AdminCompactBtn>
                      </td>
                    </>
                  );
                }
                return (
                  <>
                    <DragHandleCell {...drag} />
                    <td>{c.name}</td>
                    <td className={catalogStyles.mutedInline}>{c.slug}</td>
                    <td className={catalogStyles.mutedInline}>{c.postCount ?? 0}</td>
                    <td className={catalogStyles.tableCellActions}>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        disabled={editingId != null || deleteBusy}
                        onClick={() => startEdit(c)}
                      >
                        Переименовать
                      </AdminCompactBtn>
                      <AdminCompactBtn
                        type="button"
                        variant="danger"
                        disabled={(c.postCount ?? 0) > 0 || deleteBusy}
                        onClick={() => requestDelete(c)}
                      >
                        Удалить
                      </AdminCompactBtn>
                    </td>
                  </>
                );
              }}
            />
          )}
        </>
      ) : null}

      <AdminConfirmDialog
        open={pendingDelete != null}
        title="Удалить рубрику?"
        message={
          pendingDelete
            ? `«${pendingDelete.name}» будет удалена безвозвратно.`
            : ''
        }
        confirmLabel="Удалить"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
