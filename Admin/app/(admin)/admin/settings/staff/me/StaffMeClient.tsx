'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { adminConfirm } from '@/components/admin/AdminModal/adminConfirm';
import {
  AdminBackendRequestError,
  adminBackendFetch,
  adminBackendJson,
  readAdminApiError,
} from '@/lib/adminBackendFetch';
import { ADMIN_SECTION_LABELS_RU, type ModeratorAssignableSectionId } from '@/lib/adminSections';
import type { ResetStaffPasswordResponse, StaffAdminRow } from '@/lib/adminStaffTypes';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import { StaffFlashMessage, StaffProfileForm } from '../StaffProfileForm';
import { StaffPasswordDeliveryModal } from '../StaffPasswordDeliveryModal';
import { isStaffDisplayNameDirty, staffAvatarAltText } from '../staffUtils';
import styles from '../staffAdmin.module.css';

export function StaffMeClient() {
  const router = useRouter();
  const [row, setRow] = useState<StaffAdminRow | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [passwordModal, setPasswordModal] = useState<{
    emailSent: boolean;
    temporaryPassword?: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await adminBackendJson<StaffAdminRow>('settings/admin/staff-profile');
      setRow(me);
      setDisplayName(me.staffDisplayName ?? '');
    } catch (e) {
      setRow(null);
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const displayNameDirty = useMemo(
    () => (row ? isStaffDisplayNameDirty(displayName, row.staffDisplayName) : false),
    [displayName, row],
  );

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!row || !displayNameDirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await adminBackendJson<StaffAdminRow>('settings/admin/staff-profile', {
        method: 'PATCH',
        body: JSON.stringify({ staffDisplayName: displayName.trim() || null }),
      });
      setRow(updated);
      setDisplayName(updated.staffDisplayName ?? '');
      setFlash('Сохранено');
      window.setTimeout(() => setFlash(null), 2000);
      router.refresh();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function onAvatar(file: File) {
    if (!row) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await adminBackendFetch('settings/admin/staff-profile/avatar', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) throw new Error(await readAdminApiError(res));
      const updated = (await res.json()) as StaffAdminRow;
      setRow(updated);
      setFlash('Аватар обновлён');
      window.setTimeout(() => setFlash(null), 2000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка аватара');
    } finally {
      setUploading(false);
    }
  }

  async function requestPasswordReset() {
    if (!row) return;
    setResettingPassword(true);
    setError(null);
    try {
      const res = await adminBackendJson<ResetStaffPasswordResponse>(
        'settings/admin/staff-profile/reset-password',
        { method: 'POST' },
      );
      setPasswordModal({
        emailSent: res.emailSent === true,
        temporaryPassword: res.temporaryPassword,
      });
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Ошибка сброса пароля');
    } finally {
      setResettingPassword(false);
    }
  }

  async function onResetPassword() {
    if (!row) return;
    const ok = await adminConfirm({
      title: 'Сбросить пароль',
      message:
        'Сгенерировать новый пароль? Текущая сессия завершится — потребуется вход с новым паролем.',
      confirmLabel: 'Сбросить',
    });
    if (!ok) return;
    await requestPasswordReset();
  }

  async function retryResetPassword() {
    await requestPasswordReset();
  }

  async function closePasswordModal() {
    setPasswordModal(null);
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.assign('/admin/login');
  }

  if (loading) {
    return <p className={catalogStyles.lead}>Загрузка…</p>;
  }

  if (!row) {
    return (
      <div>
        <h1 className={catalogStyles.title}>Мой профиль</h1>
        <div className={catalogStyles.errorBanner} role="alert">
          {error ?? 'Не удалось загрузить профиль'}
        </div>
        <div className={catalogStyles.formActions} style={{ marginTop: 16 }}>
          <AdminCompactBtn type="button" variant="accent" onClick={() => void load()}>
            Повторить
          </AdminCompactBtn>
        </div>
      </div>
    );
  }

  const avatarAlt = staffAvatarAltText(displayName, row.email);

  return (
    <div>
      <h1 className={catalogStyles.title}>Мой профиль</h1>
      <p className={catalogStyles.lead}>Имя и аватар в админ-панели. Выход — в меню профиля слева внизу.</p>
      {error ? (
        <div className={catalogStyles.errorBanner} role="alert">
          {error}
        </div>
      ) : null}
      {flash ? <StaffFlashMessage message={flash} /> : null}

      <form onSubmit={onSave} className={catalogStyles.form}>
        <StaffProfileForm
          email={row.email ?? ''}
          displayName={displayName}
          onDisplayNameChange={setDisplayName}
          showAvatar
          avatarUrl={row.staffAvatarUrl}
          avatarAlt={avatarAlt}
          onAvatarSelect={(file) => void onAvatar(file)}
          avatarUploading={uploading}
          role={row.role}
          isActive={row.isActive}
          lastAdminLoginAt={row.lastAdminLoginAt}
          showMeta
        >
          <div className={styles.formSection}>
            <h2 className={`${catalogStyles.groupHeading} ${styles.panelHeading}`}>Мои разделы</h2>
            {row.role === 'ADMIN' ? (
              <p className={catalogStyles.lead}>Суперадмин — доступ ко всем разделам админки.</p>
            ) : row.adminSections.length > 0 ? (
              <ul className={styles.profileList}>
                {row.adminSections.map((sectionId: ModeratorAssignableSectionId) => (
                  <li key={sectionId} className={catalogStyles.lead}>
                    {ADMIN_SECTION_LABELS_RU[sectionId] ?? sectionId}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={catalogStyles.lead}>Разделы не назначены — обратитесь к суперадмину.</p>
            )}
            {row.role === 'MODERATOR' ? (
              <p className={catalogStyles.muted} style={{ marginTop: 8, fontSize: '0.875rem' }}>
                Изменить список может только суперадмин в разделе «Сотрудники».
              </p>
            ) : null}
          </div>
        </StaffProfileForm>

        <div className={catalogStyles.formActions}>
          <AdminCompactBtn
            type="submit"
            variant="accent"
            disabled={saving || uploading || !displayNameDirty}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </AdminCompactBtn>
          <AdminCompactBtn
            type="button"
            disabled={saving || uploading || resettingPassword}
            onClick={() => void onResetPassword()}
          >
            {resettingPassword ? 'Сброс…' : 'Сменить пароль'}
          </AdminCompactBtn>
        </div>
      </form>

      <StaffPasswordDeliveryModal
        open={passwordModal != null}
        emailSent={passwordModal?.emailSent}
        temporaryPassword={passwordModal?.temporaryPassword}
        onClose={() => void closePasswordModal()}
        onRetry={
          passwordModal && !passwordModal.emailSent
            ? () => void retryResetPassword()
            : undefined
        }
        retrying={resettingPassword}
      />
    </div>
  );
}
