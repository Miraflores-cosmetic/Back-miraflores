'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AdminSettingsListErrors } from '@/components/admin/AdminSettingsListErrors/AdminSettingsListErrors';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type { AdminUserGroup } from '@/lib/adminUserGroupTypes';
import {
  parseUserGroupTab,
  resolveUserGroupTab,
  type UserGroupTabId,
} from '@/lib/userGroupDetailTabs';
import { UserGroupGeneralTab } from '../UserGroupGeneralTab';
import { UserGroupKindBadge } from '../UserGroupKindBadge';
import { UserGroupPageNav } from '../UserGroupPageNav';
import { UserGroupMembersTab } from '../UserGroupMembersTab';
import { UserGroupPricingTab } from '../UserGroupPricingTab';
import { UserGroupVisibilityTab } from '../UserGroupVisibilityTab';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';
import settingsStyles from '@/app/(admin)/admin/settings/Settings.module.css';

const GROUPS_HREF = '/admin/settings/user-groups';

export function UserGroupDetailClient({ groupId }: { groupId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<UserGroupTabId>(() =>
    parseUserGroupTab(searchParams.get('tab')),
  );
  const [group, setGroup] = useState<AdminUserGroup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setTabAndUrl = useCallback(
    (next: UserGroupTabId) => {
      setTab(next);
      const sp = new URLSearchParams(searchParams.toString());
      if (next === 'general') sp.delete('tab');
      else sp.set('tab', next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const g = await adminBackendJson<AdminUserGroup>(`user-groups/admin/${groupId}`);
      setGroup(g);
    } catch (e) {
      setGroup(null);
      setLoadError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const refreshGroupMeta = useCallback(async () => {
    try {
      const g = await adminBackendJson<AdminUserGroup>(`user-groups/admin/${groupId}`);
      setGroup(g);
    } catch {
      /* counts refresh best-effort */
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!group) return;
    const rawTab = searchParams.get('tab');
    const fromUrl = parseUserGroupTab(rawTab);
    const resolved = resolveUserGroupTab(rawTab, group);
    setTab(resolved);

    const sp = new URLSearchParams(searchParams.toString());
    let needsReplace = false;

    if (rawTab?.trim() === 'categories') {
      sp.set('tab', 'prices');
      sp.set('section', 'categories');
      needsReplace = true;
    }

    if (fromUrl !== resolved) {
      if (resolved === 'general') sp.delete('tab');
      else sp.set('tab', resolved);
      needsReplace = true;
    }

    if (!needsReplace) return;
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [group, pathname, router, searchParams]);

  if (loading) {
    return (
      <div className={`${catalogStyles.form} ${catalogStyles.formWide}`}>
        <p className={catalogStyles.lead}>Загрузка…</p>
      </div>
    );
  }

  if (!group) {
    return (
      <div className={`${catalogStyles.form} ${catalogStyles.formWide}`}>
        <AdminSettingsListErrors
          loadError={loadError ?? 'Группа не найдена'}
          actionError={null}
          onRetry={() => void load()}
          onDismissLoad={() => setLoadError(null)}
          onDismissAction={() => setActionError(null)}
        />
      </div>
    );
  }

  const tabItems = [
    { id: 'general', label: 'Общее' },
    ...(group.assignable ? [{ id: 'members', label: `Участники (${group.counts.users})` }] : []),
    {
      id: 'prices',
      label: `Цены (${group.counts.variantPrices + group.counts.categoryPrices})`,
    },
    { id: 'visibility', label: `Видимость (${group.counts.visibilityRules})` },
  ];

  return (
    <div className={`${catalogStyles.form} ${catalogStyles.formWide}`}>
      <div className={pn.stickyToolbar}>
        <div className={pn.stickyToolbarMain}>
          <UserGroupPageNav variant="detail" />
          <h1 className={pn.stickyToolbarTitle}>{group.name}</h1>
          <div className={pn.stickyToolbarMeta}>
            <UserGroupKindBadge group={group} />
            <span className={catalogStyles.mutedInline}>· slug: {group.slug}</span>
            {!group.active ? <span className={catalogStyles.mutedInline}>· выключена</span> : null}
          </div>
        </div>
      </div>

      <AdminSettingsListErrors
        loadError={loadError}
        actionError={actionError}
        onRetry={() => void load()}
        onDismissLoad={() => setLoadError(null)}
        onDismissAction={() => setActionError(null)}
      />

      <AdminTabs
        ariaLabel="Раздел группы"
        variant="underline"
        activeId={tab}
        onChange={(id) => setTabAndUrl(id as UserGroupTabId)}
        items={tabItems}
      />

      {tab === 'general' ? (
        <UserGroupGeneralTab
          groupId={groupId}
          group={group}
          onGroupChanged={setGroup}
          onDeleted={() => router.push(GROUPS_HREF)}
          onError={setActionError}
        />
      ) : null}

      {tab === 'members' ? (
        <section className={settingsStyles.faqCard}>
          <UserGroupMembersTab
            groupId={groupId}
            assignable={group.assignable}
            onChanged={() => void refreshGroupMeta()}
          />
        </section>
      ) : null}

      {tab === 'prices' ? (
        <UserGroupPricingTab
          groupId={groupId}
          group={group}
          onChanged={() => void refreshGroupMeta()}
        />
      ) : null}

      {tab === 'visibility' ? (
        <UserGroupVisibilityTab
          groupId={groupId}
          groupName={group.name}
          onChanged={() => void refreshGroupMeta()}
        />
      ) : null}
    </div>
  );
}
