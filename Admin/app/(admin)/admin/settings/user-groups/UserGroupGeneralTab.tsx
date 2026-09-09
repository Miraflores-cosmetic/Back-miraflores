'use client';

import { useEffect, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatUserGroupMembersLabel } from '@/lib/userGroupAdminUi';
import type { AdminUserGroup } from '@/lib/adminUserGroupTypes';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import settingsStyles from '@/app/(admin)/admin/settings/Settings.module.css';

const PRICE_ROUNDING_LABELS: Record<AdminUserGroup['priceRounding'], string> = {
  NEAREST: 'К ближайшему',
  FLOOR: 'Вниз',
  CEIL: 'Вверх',
};

type Props = {
  groupId: string;
  group: AdminUserGroup;
  onGroupChanged: (group: AdminUserGroup) => void;
  onDeleted: () => void;
  onError: (message: string | null) => void;
};

export function UserGroupGeneralTab({
  groupId,
  group,
  onGroupChanged,
  onDeleted,
  onError,
}: Props) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [editName, setEditName] = useState(group.name);
  const [editSlug, setEditSlug] = useState(group.slug);
  const [editRounding, setEditRounding] = useState(group.priceRounding);

  useEffect(() => {
    setEditName(group.name);
    setEditSlug(group.slug);
    setEditRounding(group.priceRounding);
  }, [group]);

  const isSystem = group.isDefaultGuest || group.isDefaultRegistered;

  async function saveGeneral(
    patch: Partial<AdminUserGroup>,
    opts?: { toast?: boolean; toastMessage?: string },
  ) {
    setSaving(true);
    onError(null);
    try {
      const updated = await adminBackendJson<AdminUserGroup>(`user-groups/admin/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onGroupChanged(updated);
      if (opts?.toast) showToast(opts.toastMessage ?? 'Сохранено');
    } catch (e) {
      onError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  async function saveIdentity(e: React.FormEvent) {
    e.preventDefault();
    await saveGeneral(
      {
        name: editName.trim(),
        slug: editSlug.trim().toLowerCase(),
        priceRounding: editRounding,
      },
      { toast: true, toastMessage: 'Профиль группы сохранён' },
    );
  }

  async function deleteGroup() {
    setSaving(true);
    onError(null);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}`, { method: 'DELETE' });
      showToast('Группа удалена');
      onDeleted();
    } catch (e) {
      onError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось удалить');
      setSaving(false);
    }
  }

  return (
    <>
      <section className={settingsStyles.faqCard}>
        <form className={settingsStyles.menuFormStack} onSubmit={(e) => void saveIdentity(e)}>
          <AdminTextField
            label="Название"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            disabled={saving}
            maxLength={120}
          />
          <AdminTextField
            label="Slug"
            value={editSlug}
            onChange={(e) => setEditSlug(e.target.value)}
            disabled={saving || isSystem}
            maxLength={80}
          />
          {isSystem ? (
            <p className={catalogStyles.muted} style={{ margin: 0 }}>
              Slug системной группы нельзя менять.
            </p>
          ) : null}
          <label className={catalogStyles.label}>
            Округление итога по правилам категории
            <select
              className={catalogStyles.select}
              value={editRounding}
              disabled={saving}
              onChange={(e) => setEditRounding(e.target.value as AdminUserGroup['priceRounding'])}
            >
              {Object.entries(PRICE_ROUNDING_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className={catalogStyles.muted} style={{ margin: 0 }}>
            Для −% и −₽ от базовой цены (не для фиксированных SKU-цен).
          </p>
          <div>
            <AdminCompactBtn type="submit" variant="accent" disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить профиль'}
            </AdminCompactBtn>
          </div>
        </form>
      </section>

      <section className={settingsStyles.faqCard}>
        <div className={settingsStyles.menuFormStack}>
          <label className={settingsStyles.activeLabel}>
            <AdminCheckbox
              checked={group.allowCatalogDiscounts}
              disabled={saving}
              onChange={(e) =>
                void saveGeneral({ allowCatalogDiscounts: e.target.checked }, { toast: true })
              }
            />
            Кампании Discount (каталожные акции)
          </label>
          <label className={settingsStyles.activeLabel}>
            <AdminCheckbox
              checked={group.allowPromoCodes}
              disabled={saving}
              onChange={(e) =>
                void saveGeneral({ allowPromoCodes: e.target.checked }, { toast: true })
              }
            />
            Промокоды на checkout
          </label>
          <label className={settingsStyles.activeLabel}>
            <AdminCheckbox
              checked={group.active}
              disabled={saving || isSystem}
              onChange={(e) => void saveGeneral({ active: e.target.checked }, { toast: true })}
            />
            Группа активна
          </label>
          <p className={catalogStyles.muted}>
            Участники: {formatUserGroupMembersLabel(group)} · SKU-цен:{' '}
            {group.counts.variantPrices} · правил категорий: {group.counts.categoryPrices} ·
            видимость: {group.counts.visibilityRules}
          </p>
          {group.isDefaultRegistered ? (
            <p className={catalogStyles.muted} style={{ margin: 0 }}>
              Розница — все зарегистрированные без явной группы. Счётчик участников может быть 0:
              назначение автоматическое.
            </p>
          ) : null}
          {group.isDefaultGuest ? (
            <p className={catalogStyles.muted} style={{ margin: 0 }}>
              Гости попадают сюда автоматически без входа в аккаунт.
            </p>
          ) : null}
        </div>
      </section>

      {!isSystem ? (
        <section className={settingsStyles.faqCard}>
          <p className={catalogStyles.muted} style={{ margin: '0 0 12px' }}>
            Удаление возможно только без участников. Все SKU-цены, правила категорий и видимости
            группы удалятся без восстановления.
          </p>
          <AdminCompactBtn
            type="button"
            variant="danger"
            disabled={saving || group.counts.users > 0}
            onClick={() => setDeleteOpen(true)}
          >
            Удалить группу
          </AdminCompactBtn>
          {group.counts.users > 0 ? (
            <p className={catalogStyles.muted} style={{ marginTop: 8 }}>
              Сначала снимите {group.counts.users} участник(ов) на вкладке «Участники».
            </p>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить группу?"
        message={`Группа «${group.name}», все её SKU-цены, правила категорий и видимости будут удалены без восстановления.`}
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          void deleteGroup();
        }}
      />
    </>
  );
}
