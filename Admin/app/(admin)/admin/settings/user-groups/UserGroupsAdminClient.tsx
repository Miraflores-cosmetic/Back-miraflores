'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatUserGroupMembersLabel } from '@/lib/userGroupAdminUi';
import { slugify } from '@/lib/slugify';
import type { AdminUserGroupListResponse } from '@/lib/adminUserGroupTypes';
import { UserGroupKindBadge } from './UserGroupKindBadge';
import { UserGroupPageNav } from './UserGroupPageNav';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';
import settingsStyles from '@/app/(admin)/admin/settings/Settings.module.css';

const LIMIT = 20;
const GROUPS_HREF = '/admin/settings/user-groups';

type ActiveFilter = 'all' | '1' | '0';

export function UserGroupsAdminClient() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminUserGroupListResponse | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSlugTouched, setCreateSlugTouched] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setError(null);
    setFetching(true);
    try {
      const sp = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (qDebounced.trim()) sp.set('q', qDebounced.trim());
      if (activeFilter !== 'all') sp.set('active', activeFilter);
      const res = await adminBackendJson<AdminUserGroupListResponse>(`user-groups/admin?${sp}`);
      setData(res);
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить');
      setData(null);
    } finally {
      setLoading(false);
      setFetching(false);
    }
  }, [page, qDebounced, activeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setCreateError(null);
    setCreateSlugTouched(false);
    setCreateName('');
    setCreateSlug('');
    setCreateOpen(true);
  }

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
    setCreateName('');
    setCreateSlug('');
    setCreateError(null);
    setCreateSlugTouched(false);
  }

  function onCreateNameChange(name: string) {
    setCreateName(name);
    if (!createSlugTouched) {
      setCreateSlug(slugify(name).slice(0, 64));
    }
  }

  function onCreateSlugChange(slug: string) {
    setCreateSlugTouched(true);
    setCreateSlug(slug);
  }

  async function onCreate() {
    if (!createName.trim() || !createSlug.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await adminBackendJson<{ id: string }>('user-groups/admin', {
        method: 'POST',
        body: JSON.stringify({
          name: createName.trim(),
          slug: createSlug.trim().toLowerCase(),
        }),
      });
      closeCreate();
      router.push(`${GROUPS_HREF}/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось создать');
    } finally {
      setCreating(false);
    }
  }

  const items = data?.items ?? [];

  return (
    <div className={`${catalogStyles.form} ${catalogStyles.formWide}`}>
      <div className={pn.stickyToolbar}>
        <div className={pn.stickyToolbarMain}>
          <UserGroupPageNav variant="list" />
          <h1 className={pn.stickyToolbarTitle}>Группы пользователей</h1>
        </div>
        <div className={pn.stickyToolbarActions}>
          <AdminCompactBtn type="button" variant="accent" onClick={openCreate}>
            Создать группу
          </AdminCompactBtn>
        </div>
      </div>

      <AdminTabs
        ariaLabel="Фильтр по статусу"
        variant="underline"
        compact
        activeId={activeFilter}
        onChange={(id) => {
          setActiveFilter(id as ActiveFilter);
          setPage(1);
        }}
        items={[
          { id: 'all', label: 'Все' },
          { id: '1', label: 'Активные' },
          { id: '0', label: 'Выкл.' },
        ]}
      />

      <AdminListShell
        loading={loading}
        error={error}
        onRetry={() => void load()}
        loadingLabel="Загрузка…"
        empty={
          <div className={settingsStyles.settingsEmpty}>
            <p className={settingsStyles.settingsEmptyTitle}>Групп пока нет</p>
            <p className={settingsStyles.settingsEmptyHint}>
              Создайте группу для индивидуальных цен SKU, правил категорий и видимости каталога.
            </p>
            <AdminCompactBtn type="button" variant="accent" onClick={openCreate}>
              Создать первую группу
            </AdminCompactBtn>
          </div>
        }
        isEmpty={!loading && items.length === 0}
        isFetching={fetching}
        toolbar={
          items.length > 0 || qDebounced || activeFilter !== 'all' ? (
            <div className={catalogStyles.toolbar}>
              <div className={catalogStyles.searchBoxToolbar}>
                <AdminSearchBox
                  placeholder="Поиск по названию или slug"
                  ariaLabel="Поиск групп"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
          ) : null
        }
        pagination={
          data ? (
            <AdminListPagination
              page={data.page}
              limit={data.limit}
              total={data.total}
              onPageChange={setPage}
              disabled={fetching}
            />
          ) : null
        }
      >
        <table className={catalogStyles.table}>
          <thead>
            <tr>
              <th>Название</th>
              <th>Тип</th>
              <th>Участники</th>
              <th>SKU</th>
              <th>Категории</th>
              <th>Видимость</th>
            </tr>
          </thead>
          <tbody>
            {items.map((g) => (
              <tr key={g.id}>
                <td>
                  <Link href={`${GROUPS_HREF}/${g.id}`} className={catalogStyles.link}>
                    {g.name}
                  </Link>
                  {!g.active ? <span className={catalogStyles.muted}> (выкл.)</span> : null}
                </td>
                <td>
                  <UserGroupKindBadge group={g} />
                </td>
                <td className={catalogStyles.mutedInline}>{formatUserGroupMembersLabel(g)}</td>
                <td>{g.counts.variantPrices}</td>
                <td>{g.counts.categoryPrices}</td>
                <td>{g.counts.visibilityRules}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminListShell>

      <AdminModal
        open={createOpen}
        title="Новая группа"
        onClose={closeCreate}
        footer={
          <AdminModalActions
            onCancel={closeCreate}
            onConfirm={() => void onCreate()}
            confirmLabel={creating ? 'Создаём…' : 'Создать'}
            confirmDisabled={creating || !createName.trim() || !createSlug.trim()}
          />
        }
      >
        <div className={settingsStyles.menuFormStack} style={{ maxWidth: 'none', margin: 0 }}>
          {createError ? (
            <p className={catalogStyles.error} role="alert">
              {createError}
            </p>
          ) : null}
          <AdminTextField
            label="Название"
            value={createName}
            onChange={(e) => onCreateNameChange(e.target.value)}
            disabled={creating}
            maxLength={120}
          />
          <AdminTextField
            label="Slug (латиница)"
            value={createSlug}
            onChange={(e) => onCreateSlugChange(e.target.value)}
            disabled={creating}
            maxLength={64}
          />
          <p className={catalogStyles.muted} style={{ margin: 0 }}>
            Slug подставляется из названия; можно править вручную.
          </p>
        </div>
      </AdminModal>
    </div>
  );
}
