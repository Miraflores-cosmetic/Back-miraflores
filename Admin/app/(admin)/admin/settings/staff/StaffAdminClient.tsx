'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { adminConfirm } from '@/components/admin/AdminModal/adminConfirm';
import {
  AdminBackendRequestError,
  adminBackendFetch,
  adminBackendJson,
  readAdminApiError,
} from '@/lib/adminBackendFetch';
import type { ModeratorAssignableSectionId } from '@/lib/adminSections';
import type {
  CreateStaffResponse,
  ResetStaffPasswordResponse,
  StaffAdminRow,
  StaffSectionCatalogItem,
} from '@/lib/adminStaffTypes';
import { MODERATOR_CREATE_PRESET_CONTENT } from '@miraflores/admin-types';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import styles from './staffAdmin.module.css';
import { StaffFlashMessage, StaffProfileForm } from './StaffProfileForm';
import { StaffSectionsEditor } from './StaffSectionsEditor';
import { isStaffDisplayNameDirty, staffAvatarAltText } from './staffUtils';
import { StaffPasswordDeliveryModal } from './StaffPasswordDeliveryModal';

type EditorMode = 'create' | 'edit';

function sectionsEqual(
  a: readonly ModeratorAssignableSectionId[],
  b: readonly ModeratorAssignableSectionId[],
): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

export function StaffAdminClient({ currentUserId }: { currentUserId?: string | null }) {
  const router = useRouter();
  const [rows, setRows] = useState<StaffAdminRow[]>([]);
  const [sectionCatalog, setSectionCatalog] = useState<StaffSectionCatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>('edit');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [sections, setSections] = useState<ModeratorAssignableSectionId[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [passwordModal, setPasswordModal] = useState<{
    emailSent: boolean;
    temporaryPassword?: string;
    logoutOnClose?: boolean;
  } | null>(null);
  const [retryingPasswordEmail, setRetryingPasswordEmail] = useState(false);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const isSuperAdminRow = selected?.role === 'ADMIN';

  const profileDirty = useMemo(() => {
    if (mode !== 'edit' || !selected) return false;
    const nameDirty = isStaffDisplayNameDirty(displayName, selected.staffDisplayName);
    if (isSuperAdminRow) return nameDirty;
    return nameDirty || !sectionsEqual(sections, selected.adminSections);
  }, [mode, selected, displayName, isSuperAdminRow, sections]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [staffRows, catalog] = await Promise.all([
        adminBackendJson<StaffAdminRow[]>('settings/admin/staff'),
        adminBackendJson<{ assignable: StaffSectionCatalogItem[] }>(
          'settings/admin/staff/sections',
        ),
      ]);
      setRows(staffRows);
      setSectionCatalog(catalog.assignable);
      setSelectedId((cur) => {
        if (mode === 'create') return cur;
        if (cur && staffRows.some((r) => r.id === cur)) return cur;
        return staffRows.find((r) => r.role === 'MODERATOR')?.id ?? staffRows[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mode === 'create') {
      setEmail('');
      setDisplayName('');
      setAvatarUrl(null);
      setSections([...MODERATOR_CREATE_PRESET_CONTENT]);
      return;
    }
    if (!selected) return;
    setEmail(selected.email ?? '');
    setDisplayName(selected.staffDisplayName ?? '');
    setAvatarUrl(selected.staffAvatarUrl);
    setSections(
      selected.role === 'ADMIN'
        ? sectionCatalog.map((item) => item.id)
        : [...selected.adminSections],
    );
  }, [mode, selected, sectionCatalog]);

  function pushFlash(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2500);
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const res = await adminBackendJson<CreateStaffResponse>('settings/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          email,
          staffDisplayName: displayName.trim() || undefined,
          adminSections: sections,
        }),
      });
      setPasswordModal({
        emailSent: res.emailSent === true,
        temporaryPassword: res.temporaryPassword,
      });
      setMode('edit');
      setSelectedId(res.user.id);
      await load();
      pushFlash('Сотрудник создан');
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка создания');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!selected || !profileDirty) return;
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson<StaffAdminRow>(`settings/admin/staff/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          staffDisplayName: displayName.trim() || null,
          ...(isSuperAdminRow ? {} : { adminSections: sections }),
        }),
      });
      await load();
      pushFlash('Сохранено');
      if (selected.id === currentUserId) router.refresh();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    if (!selected || selected.role === 'ADMIN') return;
    if (
      selected.isActive &&
      !(await adminConfirm({
        title: 'Деактивировать сотрудника',
        message: 'Деактивировать сотрудника? Его можно будет активировать снова.',
        confirmLabel: 'Деактивировать',
        danger: true,
      }))
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson<StaffAdminRow>(`settings/admin/staff/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !selected.isActive }),
      });
      await load();
      pushFlash(selected.isActive ? 'Деактивирован' : 'Активирован');
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected || selected.role === 'ADMIN' || selected.id === currentUserId) return;
    const ok = await adminConfirm({
      title: 'Удалить сотрудника',
      message: 'Это действие необратимо.',
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson<void>(`settings/admin/staff/${selected.id}`, { method: 'DELETE' });
      setSelectedId(null);
      setMode('edit');
      await load();
      pushFlash('Удалён');
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка удаления');
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarFile(file: File) {
    if (!selected) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await adminBackendFetch(`settings/admin/staff/${selected.id}/avatar`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) throw new Error(await readAdminApiError(res));
      const row = (await res.json()) as StaffAdminRow;
      setAvatarUrl(row.staffAvatarUrl);
      await load();
      pushFlash('Аватар обновлён');
      if (selected.id === currentUserId) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки аватара');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleResetPassword() {
    if (!selected) return;
    const resettingSelf = selected.id === currentUserId;
    const ok = await adminConfirm({
      title: 'Сбросить пароль',
      message: resettingSelf
        ? 'Сброс пароля завершит текущую сессию (потребуется новый вход). Продолжить?'
        : 'Сгенерировать новый пароль для этого сотрудника?',
      confirmLabel: 'Сбросить',
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminBackendJson<ResetStaffPasswordResponse>(
        `settings/admin/staff/${selected.id}/reset-password`,
        { method: 'POST' },
      );
      setPasswordModal({
        emailSent: res.emailSent === true,
        temporaryPassword: res.temporaryPassword,
        logoutOnClose: resettingSelf,
      });
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка сброса пароля');
    } finally {
      setSaving(false);
    }
  }

  async function closePasswordModal() {
    const shouldLogout = passwordModal?.logoutOnClose === true;
    setPasswordModal(null);
    if (shouldLogout) {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.assign('/admin/login');
    }
  }

  async function handleRetryPasswordEmail() {
    if (!selected) return;
    setRetryingPasswordEmail(true);
    setError(null);
    try {
      const res = await adminBackendJson<ResetStaffPasswordResponse>(
        `settings/admin/staff/${selected.id}/reset-password`,
        { method: 'POST' },
      );
      setPasswordModal({
        emailSent: res.emailSent === true,
        temporaryPassword: res.temporaryPassword,
      });
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка сброса пароля');
    } finally {
      setRetryingPasswordEmail(false);
    }
  }

  return (
    <>
      <h1 className={catalogStyles.title}>Сотрудники</h1>
      {flash ? <StaffFlashMessage message={flash} /> : null}

      <AdminListShell
        loading={loading}
        error={error}
        onRetry={() => void load()}
        loadingLabel="Загрузка…"
        isEmpty={false}
        wrapContent={false}
      >
        <div className={styles.grid}>
          <section className={styles.listPanel}>
            <div className={`${styles.listHeader} ${styles.staffListHeader}`}>
              <h2 className={catalogStyles.groupHeading}>Список</h2>
              <AdminCompactBtn
                type="button"
                onClick={() => {
                  setMode('create');
                  setSelectedId(null);
                }}
              >
                Добавить
              </AdminCompactBtn>
            </div>
            {rows.length === 0 ? (
              <p className={catalogStyles.lead}>Пока нет сотрудников</p>
            ) : (
              <ul className={styles.profileList}>
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={`${styles.profileItem} ${
                        selectedId === row.id && mode === 'edit' ? styles.profileItemActive : ''
                      }`}
                      onClick={() => {
                        setMode('edit');
                        setSelectedId(row.id);
                      }}
                    >
                      <span className={styles.profileName}>
                        {row.staffDisplayName || row.email || row.id}
                      </span>
                      <span className={styles.profileMeta}>
                        {row.role === 'ADMIN' ? 'Суперадмин' : 'Модератор'}
                        {!row.isActive ? ' · неактивен' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.formPanel}>
            {mode === 'create' || selected ? (
              <>
                <h2 className={catalogStyles.title}>
                  {mode === 'create'
                    ? 'Новый сотрудник'
                    : selected?.staffDisplayName || selected?.email}
                </h2>

                {mode === 'create' ? (
                  <StaffProfileForm
                    email={email}
                    onEmailChange={setEmail}
                    emailDisabled={false}
                    emailType="email"
                    displayName={displayName}
                    onDisplayNameChange={setDisplayName}
                  />
                ) : selected ? (
                  <StaffProfileForm
                    email={selected.email ?? ''}
                    emailType="email"
                    displayName={displayName}
                    onDisplayNameChange={setDisplayName}
                    showAvatar
                    avatarUrl={avatarUrl}
                    avatarAlt={staffAvatarAltText(displayName, selected.email)}
                    onAvatarSelect={(file) => void handleAvatarFile(file)}
                    avatarUploading={uploadingAvatar}
                    role={selected.role}
                    isActive={selected.isActive}
                    lastAdminLoginAt={selected.lastAdminLoginAt}
                    showMeta
                  />
                ) : null}

                {!isSuperAdminRow ? (
                  <StaffSectionsEditor
                    catalog={sectionCatalog}
                    sections={sections}
                    onSectionsChange={setSections}
                  />
                ) : null}

                <div className={`${catalogStyles.formActions} ${styles.profileFormActions}`}>
                  {mode === 'create' ? (
                    <AdminCompactBtn
                      type="button"
                      variant="accent"
                      disabled={saving}
                      onClick={() => void handleCreate()}
                    >
                      Создать
                    </AdminCompactBtn>
                  ) : (
                    <>
                      <AdminCompactBtn
                        type="button"
                        variant="accent"
                        disabled={saving || uploadingAvatar || !profileDirty}
                        onClick={() => void handleSave()}
                      >
                        Сохранить
                      </AdminCompactBtn>
                      {selected?.isActive ? (
                        <>
                          <AdminCompactBtn
                            type="button"
                            disabled={saving}
                            onClick={() => void handleResetPassword()}
                          >
                            Сбросить пароль
                          </AdminCompactBtn>
                          {selected.id === currentUserId ? (
                            <p className={catalogStyles.lead} style={{ margin: 0, flexBasis: '100%' }}>
                              Сброс своего пароля завершит текущую сессию — потребуется новый вход.
                            </p>
                          ) : null}
                        </>
                      ) : null}
                      {selected && selected.role !== 'ADMIN' ? (
                        <AdminCompactBtn
                          type="button"
                          disabled={saving}
                          onClick={() => void handleToggleActive()}
                        >
                          {selected.isActive ? 'Деактивировать' : 'Активировать'}
                        </AdminCompactBtn>
                      ) : null}
                      {selected &&
                      selected.role !== 'ADMIN' &&
                      selected.id !== currentUserId ? (
                        <AdminCompactBtn
                          type="button"
                          variant="danger"
                          disabled={saving}
                          onClick={() => void handleDelete()}
                        >
                          Удалить
                        </AdminCompactBtn>
                      ) : null}
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className={catalogStyles.lead}>Выберите сотрудника или создайте нового</p>
            )}
          </section>
        </div>
      </AdminListShell>

      <StaffPasswordDeliveryModal
        open={passwordModal != null}
        emailSent={passwordModal?.emailSent ?? false}
        temporaryPassword={passwordModal?.temporaryPassword}
        onClose={() => void closePasswordModal()}
        onRetry={
          selected && !passwordModal?.logoutOnClose
            ? () => void handleRetryPasswordEmail()
            : undefined
        }
        retrying={retryingPasswordEmail}
      />
    </>
  );
}
