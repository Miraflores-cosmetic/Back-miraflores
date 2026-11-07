'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminConfirmDialog } from '@/components/admin/AdminModal/AdminConfirmDialog';
import {
  AdminCompactBtn,
  AdminCompactBtnLink,
} from '@/components/AdminCompactBtn/AdminCompactBtn';
import {
  AdminTabs,
  AdminTabsLead,
  AdminTabsPanel,
} from '@/components/AdminTabs/AdminTabs';
import {
  AdminSelect,
  AdminTextArea,
  AdminTextField,
} from '@/components/AdminTextField/AdminTextField';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime, formatAdminMoney } from '@/lib/adminFormat';
import { fillReferralShareText } from '@/lib/referralShare';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';
import styles from '../Settings.module.css';

const SETTINGS_FORM_ID = 'referral-settings-form';
const SHARE_PREVIEW_LINK = 'https://miraflores-shop.com/?mf=ABCD2345';
const SHARE_PREVIEW_CODE = 'ABCD2345';

type ReferralTabId = 'settings' | 'adjust' | 'referrers';

const REFERRAL_TABS: Array<{ id: ReferralTabId; label: string }> = [
  { id: 'settings', label: 'Настройки программы' },
  { id: 'adjust', label: 'Корректировки' },
  { id: 'referrers', label: 'Рефереры' },
];

function parseReferralTab(raw: string | null): ReferralTabId {
  if (raw === 'adjust' || raw === 'referrers' || raw === 'settings') return raw;
  return 'settings';
}

type ReferralSettingsApi = {
  enabled: boolean;
  enabledAt: string | null;
  earnPercent: number;
  earnMode: 'EVERY' | 'FIRST_GOODS_ORDER';
  linkTtlDays: number;
  minOrderRub: number;
  quarantineMode: 'DELIVERED' | 'DAYS_AFTER_PAID';
  quarantineDays: number;
  inviteeBonusEnabled: boolean;
  inviteeBonusRub: number;
  spendCapPercent: number;
  shareText: string;
  updatedAt: string;
};

type ReferrerRow = {
  userId: string;
  email: string;
  displayName: string | null;
  referralCode: string;
  referralCodeActive: boolean;
  available: number;
  pending: number;
  /** Σ EARN PENDING|POSTED. */
  earnedGross: number;
  /** EARN − |earn CLAWBACK| (без invitee). */
  earnedNet: number;
  /** |invitee CLAWBACK| — отдельно от Net. */
  inviteeClawback?: number;
};

function newAdjustIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `adj-${crypto.randomUUID()}`;
  }
  return `adj-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function shortUserId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function ReferralAdminClient() {
  const { showToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<ReferralTabId>(() =>
    parseReferralTab(searchParams.get('tab')),
  );
  const [loading, setLoading] = useState(true);
  const [loadedOk, setLoadedOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const setTabAndUrl = useCallback(
    (next: ReferralTabId) => {
      setTab(next);
      const sp = new URLSearchParams(searchParams.toString());
      if (next === 'settings') sp.delete('tab');
      else sp.set('tab', next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    setTab(parseReferralTab(searchParams.get('tab')));
  }, [searchParams]);

  const [enabled, setEnabled] = useState(false);
  const [enabledAt, setEnabledAt] = useState<string | null>(null);
  const [earnPercent, setEarnPercent] = useState('5');
  const [earnMode, setEarnMode] = useState<'EVERY' | 'FIRST_GOODS_ORDER'>('EVERY');
  const [linkTtlDays, setLinkTtlDays] = useState('60');
  const [minOrderRub, setMinOrderRub] = useState('0');
  const [quarantineMode, setQuarantineMode] = useState<
    'DELIVERED' | 'DAYS_AFTER_PAID'
  >('DELIVERED');
  const [quarantineDays, setQuarantineDays] = useState('7');
  const [inviteeBonusEnabled, setInviteeBonusEnabled] = useState(false);
  const [inviteeBonusRub, setInviteeBonusRub] = useState('0');
  const [spendCapPercent, setSpendCapPercent] = useState('100');
  const [shareText, setShareText] = useState('');

  const [referrers, setReferrers] = useState<ReferrerRow[]>([]);
  const [refQ, setRefQ] = useState('');
  /** Применённый q (только после «Найти»); «Ещё» пагинирует по нему. */
  const [appliedQ, setAppliedQ] = useState('');
  const [refCursor, setRefCursor] = useState<string | null>(null);
  const [refLoading, setRefLoading] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirm, setConfirm] = useState<
    | { type: 'disable'; row: ReferrerRow }
    | { type: 'regenerate'; row: ReferrerRow }
    | null
  >(null);

  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  /** Stable across retries of the same ADJUST; refreshed after success. */
  const adjustIdempotencyKeyRef = useRef(newAdjustIdempotencyKey());
  const searchDirty = refQ !== appliedQ;
  const sharePreview = useMemo(
    () =>
      fillReferralShareText(shareText, {
        link: SHARE_PREVIEW_LINK,
        code: SHARE_PREVIEW_CODE,
      }),
    [shareText],
  );

  const applySettings = useCallback((data: ReferralSettingsApi) => {
    setEnabled(data.enabled);
    setEnabledAt(data.enabledAt);
    setEarnPercent(String(data.earnPercent));
    setEarnMode(data.earnMode);
    setLinkTtlDays(String(data.linkTtlDays));
    setMinOrderRub(String(data.minOrderRub));
    setQuarantineMode(data.quarantineMode);
    setQuarantineDays(String(data.quarantineDays));
    setInviteeBonusEnabled(data.inviteeBonusEnabled);
    setInviteeBonusRub(String(data.inviteeBonusRub));
    setSpendCapPercent(String(data.spendCapPercent));
    setShareText(data.shareText ?? '');
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadedOk(false);
    try {
      const data = await adminBackendJson<ReferralSettingsApi>(
        'settings/admin/referral',
      );
      applySettings(data);
      setLoadedOk(true);
      setDirty(false);
    } catch (e) {
      setLoadedOk(false);
      setLoadError(
        e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки',
      );
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  const loadReferrers = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null; q?: string }) => {
      setRefLoading(true);
      try {
        const sp = new URLSearchParams();
        sp.set('limit', '20');
        const q = opts?.q ?? appliedQ;
        if (q.trim()) sp.set('q', q.trim());
        if (opts?.append && opts.cursor) sp.set('cursor', opts.cursor);
        const page = await adminBackendJson<{
          items: ReferrerRow[];
          nextCursor: string | null;
        }>(`settings/admin/referral/referrers?${sp}`);
        setReferrers((prev) =>
          opts?.append ? [...prev, ...page.items] : page.items,
        );
        setRefCursor(page.nextCursor);
      } catch (e) {
        showToast(
          e instanceof AdminBackendRequestError
            ? e.message
            : 'Не удалось загрузить рефереров',
        );
      } finally {
        setRefLoading(false);
      }
    },
    [appliedQ, showToast],
  );

  useEffect(() => {
    void loadSettings();
    void loadReferrers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial mount
  }, []);

  function markDirty() {
    setDirty(true);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!loadedOk || saving || !dirty) return;
    setSaving(true);
    try {
      const data = await adminBackendJson<ReferralSettingsApi>(
        'settings/admin/referral',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled,
            earnPercent: Math.floor(Number(earnPercent) || 0),
            earnMode,
            linkTtlDays: Math.floor(Number(linkTtlDays) || 1),
            minOrderRub: Math.floor(Number(minOrderRub) || 0),
            quarantineMode,
            quarantineDays: Math.floor(Number(quarantineDays) || 1),
            inviteeBonusEnabled,
            inviteeBonusRub: Math.floor(Number(inviteeBonusRub) || 0),
            spendCapPercent: Math.min(
              100,
              Math.max(1, Math.floor(Number(spendCapPercent) || 1)),
            ),
            shareText,
          }),
        },
      );
      applySettings(data);
      setDirty(false);
      showToast('Настройки сохранены');
    } catch (err) {
      showToast(
        err instanceof AdminBackendRequestError
          ? err.message
          : 'Ошибка сохранения',
      );
    } finally {
      setSaving(false);
    }
  }

  async function setActive(row: ReferrerRow, active: boolean) {
    await adminBackendJson(
      `settings/admin/referral/users/${row.userId}/active`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      },
    );
    setReferrers((prev) =>
      prev.map((r) =>
        r.userId === row.userId ? { ...r, referralCodeActive: active } : r,
      ),
    );
    showToast(active ? 'Ссылка включена' : 'Ссылка отключена');
  }

  function requestToggleActive(row: ReferrerRow) {
    if (row.referralCodeActive) {
      setConfirm({ type: 'disable', row });
      return;
    }
    void setActive(row, true).catch((e) => {
      showToast(e instanceof AdminBackendRequestError ? e.message : 'Ошибка');
    });
  }

  function requestRegenerate(row: ReferrerRow) {
    setConfirm({ type: 'regenerate', row });
  }

  async function runConfirm() {
    if (!confirm || confirmBusy) return;
    setConfirmBusy(true);
    try {
      if (confirm.type === 'disable') {
        await setActive(confirm.row, false);
      } else {
        const res = await adminBackendJson<{ code: string; active: boolean }>(
          `settings/admin/referral/users/${confirm.row.userId}/regenerate`,
          { method: 'POST' },
        );
        setReferrers((prev) =>
          prev.map((r) =>
            r.userId === confirm.row.userId
              ? { ...r, referralCode: res.code }
              : r,
          ),
        );
        showToast(`Новый код: ${res.code}`);
      }
      setConfirm(null);
    } catch (e) {
      showToast(e instanceof AdminBackendRequestError ? e.message : 'Ошибка');
    } finally {
      setConfirmBusy(false);
    }
  }

  async function copyUserId(userId: string) {
    try {
      await navigator.clipboard.writeText(userId);
      showToast('ID скопирован');
    } catch {
      showToast('Не удалось скопировать ID');
    }
  }

  async function onAdjust(e: React.FormEvent) {
    e.preventDefault();
    const uid = adjustUserId.trim();
    if (!uid || adjustBusy) return;
    const amount = Math.trunc(Number(adjustAmount));
    if (!Number.isFinite(amount) || amount === 0) {
      showToast('Укажите ненулевую сумму');
      return;
    }
    setAdjustBusy(true);
    try {
      const res = await adminBackendJson<{
        available: number;
        amount: number;
        replayed?: boolean;
      }>(`settings/admin/referral/users/${uid}/adjust`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': adjustIdempotencyKeyRef.current,
        },
        body: JSON.stringify({
          amount,
          note: adjustNote.trim() || undefined,
          idempotencyKey: adjustIdempotencyKeyRef.current,
        }),
      });
      const replayHint = res.replayed ? ' (повтор)' : '';
      showToast(
        `Корректировка ${res.amount > 0 ? '+' : ''}${res.amount} ₽ · доступно ${formatAdminMoney(res.available)}${replayHint}`,
      );
      adjustIdempotencyKeyRef.current = newAdjustIdempotencyKey();
      setAdjustAmount('');
      setAdjustNote('');
      setReferrers((prev) =>
        prev.map((r) =>
          r.userId === uid ? { ...r, available: res.available } : r,
        ),
      );
    } catch (err) {
      showToast(
        err instanceof AdminBackendRequestError
          ? err.message
          : 'Ошибка корректировки',
      );
    } finally {
      setAdjustBusy(false);
    }
  }

  if (loading) {
    return <p className={catalogStyles.lead}>Загрузка…</p>;
  }

  const canSave = loadedOk && dirty && !saving;

  return (
    <div className={`${catalogStyles.form} ${catalogStyles.formWide}`}>
      <div className={pn.stickyToolbar}>
        <div className={pn.stickyToolbarMain}>
          <div className={pn.stickyToolbarNav}>
            <AdminCompactBtnLink href="/admin/settings" variant="outline">
              ← Настройки
            </AdminCompactBtnLink>
            {dirty ? (
              <span className={pn.dirtyHintInline}>Несохранённые изменения</span>
            ) : null}
          </div>
          <h1 className={pn.stickyToolbarTitle}>Реферальная программа</h1>
        </div>
        <div className={pn.stickyToolbarActions}>
          {tab === 'settings' ? (
            <AdminCompactBtn
              type="submit"
              form={SETTINGS_FORM_ID}
              variant="accent"
              disabled={!canSave}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </AdminCompactBtn>
          ) : null}
        </div>
      </div>

      {loadError ? (
        <div className={catalogStyles.errorBanner} role="alert">
          <span>{loadError}</span>
          <AdminCompactBtn type="button" variant="outline" onClick={() => void loadSettings()}>
            Повторить
          </AdminCompactBtn>
        </div>
      ) : null}

      <AdminTabs
        ariaLabel="Разделы реферальной программы"
        items={REFERRAL_TABS}
        activeId={tab}
        onChange={setTabAndUrl}
      />

      {tab === 'settings' && loadedOk ? (
        <AdminTabsPanel>
          <form
            id={SETTINGS_FORM_ID}
            className={`${pn.productFormMain} ${styles.menuFormStack}`}
            onSubmit={(e) => void onSave(e)}
          >
            <section className={styles.faqCard}>
              <h2 className={pn.placementHeading}>Программа</h2>
              <label className={styles.activeLabel}>
                <AdminCheckbox
                  checked={enabled}
                  onChange={(e) => {
                    setEnabled(e.target.checked);
                    markDirty();
                  }}
                />
                Программа включена
              </label>
              {enabledAt ? (
                <p className={styles.enabledAtMeta}>
                  Включена с {formatAdminDateTime(enabledAt)}
                </p>
              ) : null}
            </section>

            <section className={styles.faqCard}>
              <h2 className={pn.placementHeading}>Начисление</h2>
              <div className={styles.heroImages}>
                <AdminTextField
                  label="% начисления рефереру"
                  value={earnPercent}
                  onChange={(e) => {
                    setEarnPercent(e.target.value.replace(/\D/g, ''));
                    markDirty();
                  }}
                  inputMode="numeric"
                />
                <AdminSelect
                  label="За какие заказы начислять"
                  value={earnMode}
                  onChange={(e) => {
                    setEarnMode(e.target.value as 'EVERY' | 'FIRST_GOODS_ORDER');
                    markDirty();
                  }}
                >
                  <option value="EVERY">Каждый оплаченный товарный заказ</option>
                  <option value="FIRST_GOODS_ORDER">
                    Только первый товарный заказ покупателя
                  </option>
                </AdminSelect>
                <AdminTextField
                  label="Мин. сумма заказа для начисления ₽"
                  value={minOrderRub}
                  onChange={(e) => {
                    setMinOrderRub(e.target.value.replace(/\D/g, ''));
                    markDirty();
                  }}
                  inputMode="numeric"
                />
                <AdminTextField
                  label="Срок жизни ссылки в браузере (дни)"
                  value={linkTtlDays}
                  onChange={(e) => {
                    setLinkTtlDays(e.target.value.replace(/\D/g, ''));
                    markDirty();
                  }}
                  inputMode="numeric"
                />
              </div>
            </section>

            <section className={styles.faqCard}>
              <h2 className={pn.placementHeading}>Карантин</h2>
              <div className={styles.heroImages}>
                <AdminSelect
                  label="Когда баланс становится доступен"
                  value={quarantineMode}
                  onChange={(e) => {
                    setQuarantineMode(
                      e.target.value as 'DELIVERED' | 'DAYS_AFTER_PAID',
                    );
                    markDirty();
                  }}
                >
                  <option value="DELIVERED">Когда заказ «Доставлен»</option>
                  <option value="DAYS_AFTER_PAID">
                    Через N дней после статуса «Оплачен»
                  </option>
                </AdminSelect>
                <AdminTextField
                  label="Дней после «Оплачен»"
                  value={quarantineDays}
                  onChange={(e) => {
                    setQuarantineDays(e.target.value.replace(/\D/g, ''));
                    markDirty();
                  }}
                  inputMode="numeric"
                  disabled={quarantineMode !== 'DAYS_AFTER_PAID'}
                />
              </div>
            </section>

            <section className={styles.faqCard}>
              <h2 className={pn.placementHeading}>Оплата балансом</h2>
              <div className={styles.heroImages}>
                <AdminTextField
                  label="Лимит оплаты балансом, % от заказа"
                  value={spendCapPercent}
                  onChange={(e) => {
                    setSpendCapPercent(e.target.value.replace(/\D/g, ''));
                    markDirty();
                  }}
                  inputMode="numeric"
                />
              </div>
            </section>

            <section className={styles.faqCard}>
              <h2 className={pn.placementHeading}>Бонус приглашённому</h2>
              <label className={styles.activeLabel}>
                <AdminCheckbox
                  checked={inviteeBonusEnabled}
                  onChange={(e) => {
                    setInviteeBonusEnabled(e.target.checked);
                    markDirty();
                  }}
                />
                Начислять бонус приглашённому
              </label>
              <div className={styles.heroImages}>
                <AdminTextField
                  label="Сумма бонуса ₽"
                  value={inviteeBonusRub}
                  onChange={(e) => {
                    setInviteeBonusRub(e.target.value.replace(/\D/g, ''));
                    markDirty();
                  }}
                  inputMode="numeric"
                  disabled={!inviteeBonusEnabled}
                />
              </div>
            </section>

            <section className={styles.faqCard}>
              <h2 className={pn.placementHeading}>Шаринг</h2>
              <AdminTextArea
                label="Текст шаринга ({link}, {code})"
                value={shareText}
                onChange={(e) => {
                  setShareText(e.target.value);
                  markDirty();
                }}
                rows={3}
              />
              <p className={styles.sharePreviewLabel}>Превью</p>
              <p className={styles.sharePreview}>{sharePreview}</p>
            </section>
          </form>
        </AdminTabsPanel>
      ) : null}

      {tab === 'adjust' ? (
        <AdminTabsPanel>
          <section className={styles.faqCard}>
            <h2 className={pn.placementHeading}>Ручная корректировка</h2>
            <AdminTabsLead>
              Плюс или минус к доступному балансу. Повтор с тем же ключом не
              удваивает сумму.
            </AdminTabsLead>
            <form
              className={styles.heroImages}
              onSubmit={(e) => void onAdjust(e)}
            >
              <AdminTextField
                label="userId"
                value={adjustUserId}
                onChange={(e) => setAdjustUserId(e.target.value)}
                placeholder="cuid пользователя"
              />
              <AdminTextField
                label="Сумма ₽ (±)"
                value={adjustAmount}
                onChange={(e) =>
                  setAdjustAmount(e.target.value.replace(/[^\d-]/g, ''))
                }
                inputMode="numeric"
              />
              <AdminTextField
                label="Комментарий"
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
              />
              <div className={styles.formActionsEnd}>
                <AdminCompactBtn type="submit" disabled={adjustBusy}>
                  {adjustBusy ? '…' : 'Применить'}
                </AdminCompactBtn>
              </div>
            </form>
          </section>
        </AdminTabsPanel>
      ) : null}

      {tab === 'referrers' ? (
        <AdminTabsPanel>
          <section className={styles.faqCard}>
            <h2 className={pn.placementHeading}>Рефереры</h2>
            <div className={styles.heroImages}>
              <AdminTextField
                label="Поиск (email / код / имя)"
                value={refQ}
                onChange={(e) => {
                  setRefQ(e.target.value);
                  setRefCursor(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setAppliedQ(refQ);
                    setRefCursor(null);
                    void loadReferrers({ q: refQ });
                  }
                }}
              />
              <div className={styles.formActionsEnd}>
                <AdminCompactBtn
                  type="button"
                  variant="outline"
                  disabled={refLoading}
                  onClick={() => {
                    setAppliedQ(refQ);
                    setRefCursor(null);
                    void loadReferrers({ q: refQ });
                  }}
                >
                  Найти
                </AdminCompactBtn>
              </div>
            </div>
            {searchDirty ? (
              <p className={styles.searchHint}>
                Нажмите «Найти», чтобы применить поиск (пагинация сброшена).
              </p>
            ) : null}
            {refLoading && referrers.length === 0 ? (
              <div className={catalogStyles.tableWrap}>
                <table className={catalogStyles.table}>
                  <thead>
                    <tr>
                      <th>Код</th>
                      <th>Email</th>
                      <th>Доступно</th>
                      <th>Ожидает</th>
                      <th>Earned</th>
                      <th>Net</th>
                      <th>Статус / код</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 5 }, (_, i) => (
                      <tr key={`sk-${i}`} aria-hidden>
                        <td>
                          <div
                            className={`${styles.tableSkeletonCell} ${styles.tableSkeletonCellShort}`}
                          />
                        </td>
                        <td>
                          <div
                            className={`${styles.tableSkeletonCell} ${styles.tableSkeletonCellMed}`}
                          />
                        </td>
                        <td>
                          <div
                            className={`${styles.tableSkeletonCell} ${styles.tableSkeletonCellShort}`}
                          />
                        </td>
                        <td>
                          <div
                            className={`${styles.tableSkeletonCell} ${styles.tableSkeletonCellShort}`}
                          />
                        </td>
                        <td>
                          <div
                            className={`${styles.tableSkeletonCell} ${styles.tableSkeletonCellShort}`}
                          />
                        </td>
                        <td>
                          <div
                            className={`${styles.tableSkeletonCell} ${styles.tableSkeletonCellShort}`}
                          />
                        </td>
                        <td>
                          <div
                            className={`${styles.tableSkeletonCell} ${styles.tableSkeletonCellMed}`}
                          />
                        </td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : referrers.length === 0 ? (
              <div className={styles.settingsEmpty}>
                <p className={styles.settingsEmptyTitle}>Нет кодов</p>
                <p className={styles.settingsEmptyHint}>
                  Реферальные коды выдаются покупателям в личном кабинете.
                </p>
              </div>
            ) : (
              <div className={catalogStyles.tableWrap}>
                <table className={catalogStyles.table}>
                  <thead>
                    <tr>
                      <th>Код</th>
                      <th>Email</th>
                      <th>Доступно</th>
                      <th>Ожидает</th>
                      <th>Earned</th>
                      <th>Net</th>
                      <th>Статус / код</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {referrers.map((r) => (
                      <tr key={r.userId}>
                        <td>
                          <code>{r.referralCode}</code>
                        </td>
                        <td>
                          <div className={styles.emailCell}>
                            <Link
                              href={`/admin/users?q=${encodeURIComponent(r.email)}`}
                            >
                              {r.displayName || r.email}
                            </Link>
                            <button
                              type="button"
                              className={styles.copyIdBtn}
                              title={`${r.userId} — скопировать`}
                              aria-label={`Скопировать id ${r.userId}`}
                              onClick={() => void copyUserId(r.userId)}
                            >
                              ID {shortUserId(r.userId)}
                            </button>
                          </div>
                        </td>
                        <td>{formatAdminMoney(r.available)}</td>
                        <td>{formatAdminMoney(r.pending)}</td>
                        <td>{formatAdminMoney(r.earnedGross)}</td>
                        <td>
                          {formatAdminMoney(r.earnedNet)}
                          {(r.inviteeClawback ?? 0) > 0 ? (
                            <div className={catalogStyles.muted}>
                              бонус claw −
                              {formatAdminMoney(r.inviteeClawback ?? 0)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {r.referralCodeActive ? 'активна' : 'отключена'}
                          <div className={styles.codeActionsRow}>
                            <AdminCompactBtn
                              type="button"
                              variant="outline"
                              onClick={() => requestToggleActive(r)}
                            >
                              {r.referralCodeActive ? 'Выкл' : 'Вкл'}
                            </AdminCompactBtn>
                            <AdminCompactBtn
                              type="button"
                              variant="outline"
                              onClick={() => requestRegenerate(r)}
                            >
                              Новый код
                            </AdminCompactBtn>
                          </div>
                        </td>
                        <td className={catalogStyles.tableCellActions}>
                          <AdminCompactBtn
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setAdjustUserId(r.userId);
                              setTabAndUrl('adjust');
                            }}
                          >
                            ADJUST
                          </AdminCompactBtn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {refCursor && !searchDirty && referrers.length > 0 ? (
              <AdminCompactBtn
                type="button"
                variant="outline"
                disabled={refLoading}
                onClick={() =>
                  void loadReferrers({ append: true, cursor: refCursor })
                }
              >
                Ещё
              </AdminCompactBtn>
            ) : null}
          </section>
        </AdminTabsPanel>
      ) : null}

      <AdminConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm?.type === 'regenerate'
            ? 'Сменить реферальный код?'
            : 'Отключить реферальную ссылку?'
        }
        message={
          confirm?.type === 'regenerate'
            ? `Код ${confirm.row.referralCode} станет недействительным. Старые ?mf= перестанут атрибутировать.`
            : `Ссылка ${confirm?.row.referralCode ?? ''} перестанет работать, пока не включите снова.`
        }
        confirmLabel={
          confirm?.type === 'regenerate' ? 'Сменить код' : 'Отключить'
        }
        danger
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setConfirm(null);
        }}
        onConfirm={() => void runConfirm()}
      />
    </div>
  );
}
