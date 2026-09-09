'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Checkbox } from '@/components/Checkbox/Checkbox';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { FloatingTextField } from '@/components/FloatingTextField/FloatingTextField';
import { PhoneField } from '@/components/PhoneField/PhoneField';
import { PrimaryBtn } from '@/components/PrimaryBtn/PrimaryBtn';
import {
  ShippingCarrierModal,
  type ShippingSelection,
} from '@/components/shipping/ShippingCarrierModal';
import { useToast } from '@/components/Toast/ToastProvider';
import { useBuyerAuth } from '@/lib/BuyerAuthProvider';
import { formatPhoneE164, isValidPhone } from '@/lib/phone';
import { firstPasswordError } from '@/lib/passwordPolicy';
import { displayJcosAddressComment } from '@/lib/shipping/addressShippingMeta';
import {
  addressToShippingSeed,
  buyerDeliveryTitle,
  formatBuyerDeliveryLine,
  shippingSelectionToAddressPayload,
} from '@/lib/shipping/buyerAddressHelpers';
import { PasswordMeter } from '../login/PasswordMeter';
import {
  type BuyerAddress,
  type BuyerProfile,
} from './accountTypes';
import styles from './AccountPage.module.css';

export function AccountUserClient() {
  const { showToast } = useToast();
  const { logout: logoutBuyer } = useBuyerAuth();
  const marketingId = useId();
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [addresses, setAddresses] = useState<BuyerAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BuyerAddress | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meRes, addrRes] = await Promise.all([
        fetch('/api/account/me', { credentials: 'same-origin' }),
        fetch('/api/account/addresses', { credentials: 'same-origin' }),
      ]);
      if (!meRes.ok) {
        setError('Не удалось загрузить профиль');
        return;
      }
      const me = (await meRes.json()) as BuyerProfile;
      setProfile(me);
      setDisplayName(me.displayName ?? '');
      setPhone(me.phone ?? '');
      setMarketingConsent(me.marketingConsent);
      if (addrRes.ok) {
        const list = (await addrRes.json()) as BuyerAddress[];
        setAddresses(Array.isArray(list) ? list : []);
      }
    } catch {
      setError('Сеть недоступна');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const phoneRaw = phone.trim();
    if (phoneRaw && !isValidPhone(phoneRaw)) {
      setError('Введите телефон в формате +7… или 8…');
      setSaving(false);
      return;
    }
    try {
      const res = await fetch('/api/account/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          phone: phoneRaw ? formatPhoneE164(phoneRaw) : null,
          marketingConsent,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as BuyerProfile & {
        error?: string;
      };
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Не удалось сохранить');
        return;
      }
      setProfile(data);
      setDisplayName(data.displayName ?? '');
      setPhone(data.phone ?? '');
      setMarketingConsent(data.marketingConsent);
      showToast('Профиль сохранён');
    } catch {
      setError('Сеть недоступна');
    } finally {
      setSaving(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);
    setError(null);
    if (!currentPassword) {
      setPasswordMsg('Введите текущий пароль');
      return;
    }
    const pwErr = firstPasswordError(newPassword);
    if (pwErr) {
      setPasswordMsg(pwErr);
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordMsg('Пароли не совпадают');
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await fetch('/api/account/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPasswordMsg(
          typeof data.error === 'string' ? data.error : 'Не удалось сменить пароль',
        );
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
      setPasswordOpen(false);
      setPasswordMsg(null);
      showToast('Пароль обновлён — войдите снова');
      await logoutBuyer({ redirectTo: '/login?from=/account' });
    } catch {
      setPasswordMsg('Сеть недоступна');
    } finally {
      setPasswordSaving(false);
    }
  }

  async function removeAddress(id: string) {
    const res = await fetch(`/api/account/addresses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(typeof data.error === 'string' ? data.error : 'Не удалось удалить');
      return;
    }
    setAddresses((prev) => prev.filter((a) => a.id !== id));
    void load();
  }

  async function confirmRemoveAddress() {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    await removeAddress(id);
  }

  async function makeDefault(id: string) {
    const res = await fetch(
      `/api/account/addresses/${encodeURIComponent(id)}/default`,
      { method: 'POST', credentials: 'same-origin' },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(typeof data.error === 'string' ? data.error : 'Не удалось обновить');
      return;
    }
    const list = (await res.json()) as BuyerAddress[];
    setAddresses(Array.isArray(list) ? list : []);
  }

  async function saveDelivery(selection: ShippingSelection) {
    setError(null);
    const payload = shippingSelectionToAddressPayload(selection);
    const editId = editing?.id ?? null;
    const res = await fetch(
      editId
        ? `/api/account/addresses/${encodeURIComponent(editId)}`
        : '/api/account/addresses',
      {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string | string[];
    };
    if (!res.ok) {
      const msg =
        typeof data.error === 'string'
          ? data.error
          : Array.isArray(data.message)
            ? data.message[0]
            : typeof data.message === 'string'
              ? data.message
              : 'Не удалось сохранить доставку';
      setError(msg);
      return;
    }
    setModalOpen(false);
    setEditing(null);
    showToast(editId ? 'Доставка обновлена' : 'Доставка сохранена');
    void load();
  }

  return (
    <>
      {loading ? (
        <p className={styles.loading}>Загрузка профиля…</p>
      ) : (
        <>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <form className={styles.profileCard} onSubmit={(e) => void saveProfile(e)}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Профиль</h2>
              <div className={styles.sectionHeadActions}>
                <button
                  type="button"
                  className={styles.changePasswordLink}
                  onClick={() => {
                    setPasswordOpen((v) => !v);
                    setPasswordMsg(null);
                  }}
                >
                  Сменить пароль
                </button>
              </div>
            </div>
            <div className={styles.profileRow}>
              <span className={styles.profileLabel}>Email</span>
              <span className={styles.profileValue}>{profile?.email}</span>
            </div>
            {profile?.pricing?.group ? (
              <div className={styles.profileRow}>
                <span className={styles.profileLabel}>Группа цен</span>
                <span className={styles.profileValue}>{profile.pricing.group.name}</span>
              </div>
            ) : null}
            <FloatingTextField
              label="Имя"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
            <PhoneField
              label="Телефон"
              value={phone}
              onChange={setPhone}
            />
            <div className={styles.consentRow}>
              <Checkbox
                id={marketingId}
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
              />
              <label htmlFor={marketingId} className={styles.consentLabel}>
                Получать новости и предложения Jcos на email
              </label>
            </div>
            <div className={styles.profileSaveRow}>
              <PrimaryBtn
                type="submit"
                className={styles.profileSave}
                disabled={saving}
              >
                {saving ? 'Сохранение…' : 'Сохранить'}
              </PrimaryBtn>
            </div>
          </form>

          {passwordOpen ? (
            <form
              className={`${styles.profileCard} ${styles.passwordBlock}`}
              onSubmit={(e) => void savePassword(e)}
            >
              <h3 className={styles.sectionTitle}>Смена пароля</h3>
              <FloatingTextField
                label="Текущий пароль"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <div className={styles.passwordStack}>
                <FloatingTextField
                  label="Новый пароль"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <PasswordMeter password={newPassword} />
              </div>
              <FloatingTextField
                label="Повторите новый пароль"
                type="password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
              {passwordMsg ? (
                <p className={styles.error} role="status">
                  {passwordMsg}
                </p>
              ) : null}
              <PrimaryBtn type="submit" disabled={passwordSaving}>
                {passwordSaving ? 'Сохранение…' : 'Обновить пароль'}
              </PrimaryBtn>
            </form>
          ) : null}

          <div className={styles.addrHead}>
            <h2 className={styles.sectionTitle}>Доставка</h2>
            <button
              type="button"
              className={styles.addBtn}
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              + Новая доставка
            </button>
          </div>

          {addresses.length === 0 ? (
            <p className={styles.empty}>
              Пока нет сохранённых способов доставки — СДЭК или Яндекс
            </p>
          ) : (
            <ul className={styles.addrList}>
              {addresses.map((a) => {
                const userComment = displayJcosAddressComment(a.comment);
                return (
                  <li key={a.id} className={styles.addrCard}>
                    <div className={styles.addrBody}>
                      <p className={styles.addrTitle}>{buyerDeliveryTitle(a)}</p>
                      <p className={styles.addrMeta}>
                        {formatBuyerDeliveryLine(a)}
                      </p>
                      {a.recipientName?.trim() ? (
                        <p className={styles.addrMeta}>{a.recipientName}</p>
                      ) : null}
                      {a.phone ? (
                        <p className={styles.addrMeta}>{a.phone}</p>
                      ) : null}
                      {userComment ? (
                        <p className={styles.addrMeta}>{userComment}</p>
                      ) : null}
                      {a.isDefault ? (
                        <span className={styles.addrBadge}>По умолчанию</span>
                      ) : null}
                    </div>
                    <div className={styles.addrActions}>
                      {!a.isDefault ? (
                        <button
                          type="button"
                          className={styles.addrAction}
                          onClick={() => void makeDefault(a.id)}
                        >
                          Сделать основным
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={styles.addrAction}
                        onClick={() => {
                          setEditing(a);
                          setModalOpen(true);
                        }}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        className={`${styles.addrAction} ${styles.addrActionDanger}`}
                        onClick={() => setDeleteId(a.id)}
                      >
                        Удалить
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <ShippingCarrierModal
            open={modalOpen}
            profileDefaults={{
              recipientName: displayName,
              phone,
            }}
            seed={editing ? addressToShippingSeed(editing) : null}
            onClose={() => {
              setModalOpen(false);
              setEditing(null);
            }}
            onConfirm={(selection) => {
              void saveDelivery(selection);
            }}
          />

          <ConfirmDialog
            open={Boolean(deleteId)}
            title="Удалить доставку?"
            message="Способ доставки будет удалён из личного кабинета. Это действие нельзя отменить."
            confirmLabel="Удалить"
            cancelLabel="Отмена"
            onConfirm={() => void confirmRemoveAddress()}
            onCancel={() => setDeleteId(null)}
          />
        </>
      )}
    </>
  );
}
