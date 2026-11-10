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

type ReferralTabId = 'settings' | 'funnel' | 'adjust' | 'referrers';

const REFERRAL_TABS: Array<{ id: ReferralTabId; label: string }> = [
  { id: 'settings', label: 'Настройки программы' },
  { id: 'funnel', label: 'Воронка' },
  { id: 'adjust', label: 'Корректировки' },
  { id: 'referrers', label: 'Рефереры' },
];

function parseReferralTab(raw: string | null): ReferralTabId {
  if (
    raw === 'adjust' ||
    raw === 'referrers' ||
    raw === 'settings' ||
    raw === 'funnel'
  ) {
    return raw;
  }
  return 'settings';
}

type FunnelApi = {
  period: { kind: string; fromDate: string; toDate: string };
  totals: { visits: number; sticky: number; orders: number; paid: number };
  rates: {
    visitToSticky: number | null;
    stickyToOrder: number | null;
    orderToPaid: number | null;
    visitToPaid: number | null;
  };
  topCodes: Array<{
    code: string;
    referrerUserId: string | null;
    referrerEmail: string | null;
    visits: number;
    sticky: number;
    orders: number;
    paid: number;
  }>;
  series: Array<{
    day: string;
    visits: number;
    sticky: number;
    orders: number;
    paid: number;
  }>;
};

function formatRate(v: number | null): string {
  if (v == null) return '—';
  return `${v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

type ReferralSettingsApi = {
  enabled: boolean;
  enabledAt: string | null;
  earnPercent: number;
  earnMode: 'EVERY' | 'FIRST_GOODS_ORDER';
  earnWindowMaxOrders: number;
  earnWindowDays: number;
  linkTtlDays: number;
  minOrderRub: number;
  quarantineMode: 'DELIVERED' | 'DAYS_AFTER_PAID' | 'DELIVERED_PLUS_DAYS';
  quarantineDays: number;
  inviteeBonusEnabled: boolean;
  inviteeBonusRub: number;
  spendCapPercent: number;
  monthlyEarnCapRub: number;
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
  invitees: number;
  gmv: number;
};

type ReferrerSort = 'earned' | 'invitees' | 'gmv' | 'id';

type LiabilityApi = {
  available: number;
  pending: number;
  liability: number;
  debt: number;
};

type DeadTouchRow = {
  orderId: string;
  orderNumber: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
};

type AddressMatchRow = {
  orderId: string;
  orderNumber: string | null;
  orderStatus: string;
  code: string;
  referrerUserId: string;
  referrerEmail: string | null;
  addressMatchReason: string | null;
  pendingEarn: number;
  pendingInviteeBonus: number;
  createdAt: string;
};

type SettingsRevisionRow = {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  snapshot: ReferralSettingsApi;
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
  const [earnMode, setEarnMode] = useState<'EVERY' | 'FIRST_GOODS_ORDER'>(
    'FIRST_GOODS_ORDER',
  );
  const [earnWindowMaxOrders, setEarnWindowMaxOrders] = useState('0');
  const [earnWindowDays, setEarnWindowDays] = useState('90');
  const [linkTtlDays, setLinkTtlDays] = useState('60');
  const [minOrderRub, setMinOrderRub] = useState('0');
  const [quarantineMode, setQuarantineMode] = useState<
    'DELIVERED' | 'DAYS_AFTER_PAID' | 'DELIVERED_PLUS_DAYS'
  >('DELIVERED');
  const [quarantineDays, setQuarantineDays] = useState('7');
  const [inviteeBonusEnabled, setInviteeBonusEnabled] = useState(false);
  const [inviteeBonusRub, setInviteeBonusRub] = useState('0');
  const [spendCapPercent, setSpendCapPercent] = useState('100');
  const [monthlyEarnCapRub, setMonthlyEarnCapRub] = useState('0');
  const [shareText, setShareText] = useState('');

  const [referrers, setReferrers] = useState<ReferrerRow[]>([]);
  const [refQ, setRefQ] = useState('');
  /** Применённый q (только после «Найти»); «Ещё» пагинирует по нему. */
  const [appliedQ, setAppliedQ] = useState('');
  const [refOffset, setRefOffset] = useState(0);
  const [refNextOffset, setRefNextOffset] = useState<number | null>(null);
  const [refSort, setRefSort] = useState<ReferrerSort>('earned');
  const [refDir, setRefDir] = useState<'asc' | 'desc'>('desc');
  const [refLoading, setRefLoading] = useState(false);
  const [liability, setLiability] = useState<LiabilityApi | null>(null);
  const [deadTouches, setDeadTouches] = useState<{
    count: number;
    items: DeadTouchRow[];
  } | null>(null);
  const [deadBusyId, setDeadBusyId] = useState<string | null>(null);
  const [addressMatches, setAddressMatches] = useState<{
    count: number;
    items: AddressMatchRow[];
  } | null>(null);
  const [addressBusyId, setAddressBusyId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<SettingsRevisionRow[]>([]);

  const [funnel, setFunnel] = useState<FunnelApi | null>(null);
  const [funnelPeriod, setFunnelPeriod] = useState<
    'today' | 'last_7' | 'month' | 'custom'
  >('last_7');
  const [funnelFrom, setFunnelFrom] = useState('');
  const [funnelTo, setFunnelTo] = useState('');
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  /** При regenerate: true = оставить старые ?mf= на TTL (grace). */
  const [regenKeepGrace, setRegenKeepGrace] = useState(false);
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
    setEarnWindowMaxOrders(String(data.earnWindowMaxOrders ?? 0));
    setEarnWindowDays(String(data.earnWindowDays ?? 90));
    setLinkTtlDays(String(data.linkTtlDays));
    setMinOrderRub(String(data.minOrderRub));
    setQuarantineMode(data.quarantineMode);
    setQuarantineDays(String(data.quarantineDays));
    setInviteeBonusEnabled(data.inviteeBonusEnabled);
    setInviteeBonusRub(String(data.inviteeBonusRub));
    setSpendCapPercent(String(data.spendCapPercent));
    setMonthlyEarnCapRub(String(data.monthlyEarnCapRub ?? 0));
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

  const loadLiability = useCallback(async () => {
    try {
      const data = await adminBackendJson<LiabilityApi>(
        'settings/admin/referral/liability',
      );
      setLiability(data);
    } catch {
      setLiability(null);
    }
  }, []);

  const loadDeadTouches = useCallback(async () => {
    try {
      const data = await adminBackendJson<{
        count: number;
        items: DeadTouchRow[];
      }>('settings/admin/referral/touches/dead?limit=20');
      setDeadTouches(data);
    } catch {
      setDeadTouches(null);
    }
  }, []);

  const loadAddressMatches = useCallback(async () => {
    try {
      const data = await adminBackendJson<{
        count: number;
        items: AddressMatchRow[];
      }>('settings/admin/referral/address-matches?limit=30');
      setAddressMatches(data);
    } catch {
      setAddressMatches(null);
    }
  }, []);

  const requeueDead = useCallback(
    async (orderId: string) => {
      if (deadBusyId) return;
      setDeadBusyId(orderId);
      try {
        await adminBackendJson(
          `settings/admin/referral/touches/${orderId}/requeue`,
          { method: 'POST' },
        );
        showToast('Touch поставлен в очередь');
        await loadDeadTouches();
      } catch (e) {
        showToast(
          e instanceof AdminBackendRequestError ? e.message : 'Ошибка retry',
        );
      } finally {
        setDeadBusyId(null);
      }
    },
    [deadBusyId, loadDeadTouches, showToast],
  );

  const resolveAddressMatch = useCallback(
    async (orderId: string, action: 'approve' | 'reject') => {
      if (addressBusyId) return;
      setAddressBusyId(orderId);
      try {
        await adminBackendJson(
          `settings/admin/referral/orders/${orderId}/${action}-address`,
          { method: 'POST' },
        );
        showToast(
          action === 'approve' ? 'Начисление разрешено' : 'Начисление отклонено',
        );
        await Promise.all([loadAddressMatches(), loadLiability()]);
      } catch (e) {
        showToast(
          e instanceof AdminBackendRequestError
            ? e.message
            : action === 'approve'
              ? 'Не удалось разрешить'
              : 'Не удалось отклонить',
        );
      } finally {
        setAddressBusyId(null);
      }
    },
    [addressBusyId, loadAddressMatches, loadLiability, showToast],
  );

  const loadRevisions = useCallback(async () => {
    try {
      const data = await adminBackendJson<{ items: SettingsRevisionRow[] }>(
        'settings/admin/referral/revisions?limit=15',
      );
      setRevisions(data.items);
    } catch {
      setRevisions([]);
    }
  }, []);

  const loadReferrers = useCallback(
    async (opts?: {
      append?: boolean;
      offset?: number;
      q?: string;
      sort?: ReferrerSort;
      dir?: 'asc' | 'desc';
    }) => {
      setRefLoading(true);
      try {
        const sp = new URLSearchParams();
        sp.set('limit', '20');
        const q = opts?.q ?? appliedQ;
        const sort = opts?.sort ?? refSort;
        const dir = opts?.dir ?? refDir;
        const offset = opts?.append
          ? (opts.offset ?? refNextOffset ?? 0)
          : (opts?.offset ?? 0);
        if (q.trim()) sp.set('q', q.trim());
        sp.set('sort', sort);
        sp.set('dir', dir);
        if (offset > 0) sp.set('offset', String(offset));
        const page = await adminBackendJson<{
          items: ReferrerRow[];
          nextOffset: number | null;
          sort: ReferrerSort;
          dir: 'asc' | 'desc';
        }>(`settings/admin/referral/referrers?${sp}`);
        setReferrers((prev) =>
          opts?.append ? [...prev, ...page.items] : page.items,
        );
        setRefOffset(offset);
        setRefNextOffset(page.nextOffset);
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
    [appliedQ, refDir, refNextOffset, refSort, showToast],
  );

  const loadFunnel = useCallback(async () => {
    setFunnelLoading(true);
    setFunnelError(null);
    try {
      const sp = new URLSearchParams();
      sp.set('period', funnelPeriod);
      if (funnelPeriod === 'custom') {
        if (funnelFrom.trim()) sp.set('from', funnelFrom.trim());
        if (funnelTo.trim()) sp.set('to', funnelTo.trim());
      }
      sp.set('topLimit', '20');
      const data = await adminBackendJson<FunnelApi>(
        `settings/admin/referral/funnel?${sp}`,
      );
      setFunnel(data);
    } catch (e) {
      setFunnel(null);
      setFunnelError(
        e instanceof AdminBackendRequestError
          ? e.message
          : 'Не удалось загрузить воронку',
      );
    } finally {
      setFunnelLoading(false);
    }
  }, [funnelPeriod, funnelFrom, funnelTo]);

  useEffect(() => {
    void loadSettings();
    void loadLiability();
    void loadDeadTouches();
    void loadAddressMatches();
    void loadRevisions();
    void loadReferrers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial mount
  }, []);

  useEffect(() => {
    if (tab === 'funnel') void loadFunnel();
  }, [tab, loadFunnel]);

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
            earnWindowMaxOrders: Math.floor(Number(earnWindowMaxOrders) || 0),
            earnWindowDays: Math.floor(Number(earnWindowDays) || 0),
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
            monthlyEarnCapRub: Math.floor(Number(monthlyEarnCapRub) || 0),
            shareText,
          }),
        },
      );
      applySettings(data);
      setDirty(false);
      showToast('Настройки сохранены');
      void loadRevisions();
      void loadLiability();
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
    setRegenKeepGrace(false);
    setConfirm({ type: 'regenerate', row });
  }

  async function runConfirm() {
    if (!confirm || confirmBusy) return;
    setConfirmBusy(true);
    try {
      if (confirm.type === 'disable') {
        await setActive(confirm.row, false);
      } else {
        const res = await adminBackendJson<{
          code: string;
          active: boolean;
          grace: boolean;
        }>(`settings/admin/referral/users/${confirm.row.userId}/regenerate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grace: regenKeepGrace }),
        });
        setReferrers((prev) =>
          prev.map((r) =>
            r.userId === confirm.row.userId
              ? { ...r, referralCode: res.code }
              : r,
          ),
        );
        showToast(
          res.grace
            ? `Новый код: ${res.code} (старые ссылки ещё в grace)`
            : `Новый код: ${res.code} (старые ссылки отозваны)`,
        );
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

      {liability ? (
        <div className={styles.kpiGrid} style={{ marginBottom: 16 }}>
          <div className={styles.kpi}>
            <div className={styles.kpiValue}>
              {formatAdminMoney(liability.liability)}
            </div>
            <div>Обязательства (available + pending)</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiValue}>
              {formatAdminMoney(liability.available)}
            </div>
            <div>Доступно к списанию</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiValue}>
              {formatAdminMoney(liability.pending)}
            </div>
            <div>В карантине</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiValue}>
              {formatAdminMoney(liability.debt)}
            </div>
            <div>Долг clawback</div>
          </div>
          {deadTouches && deadTouches.count > 0 ? (
            <div className={styles.kpi}>
              <div className={styles.kpiValue}>{deadTouches.count}</div>
              <div>Touch DEAD (лимит попыток)</div>
            </div>
          ) : null}
          {addressMatches && addressMatches.count > 0 ? (
            <div className={styles.kpi}>
              <div className={styles.kpiValue}>{addressMatches.count}</div>
              <div>Подозрение self-ref</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {addressMatches && addressMatches.count > 0 ? (
        <section className={styles.faqCard} style={{ marginBottom: 16 }}>
          <h2 className={pn.placementHeading}>
            Подозрительные заказы ({addressMatches.count})
          </h2>
          <p className={styles.enabledAtMeta} style={{ marginTop: 0 }}>
            Совпадение адреса/ПВЗ с реферером — начисления удерживаются до
            решения.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {addressMatches.items.map((row) => (
              <li key={row.orderId} style={{ marginBottom: 10 }}>
                <Link href={`/admin/orders/${row.orderId}`}>
                  {row.orderNumber || shortUserId(row.orderId)}
                </Link>
                {' · '}
                {row.referrerEmail || shortUserId(row.referrerUserId)}
                {row.addressMatchReason ? ` · ${row.addressMatchReason}` : ''}
                {' · earn '}
                {formatAdminMoney(row.pendingEarn)}
                {row.pendingInviteeBonus > 0
                  ? ` · invitee ${formatAdminMoney(row.pendingInviteeBonus)}`
                  : ''}
                {' '}
                <AdminCompactBtn
                  type="button"
                  variant="outline"
                  disabled={addressBusyId === row.orderId}
                  onClick={() => void resolveAddressMatch(row.orderId, 'approve')}
                >
                  {addressBusyId === row.orderId ? '…' : 'Разрешить'}
                </AdminCompactBtn>{' '}
                <AdminCompactBtn
                  type="button"
                  variant="outline"
                  disabled={addressBusyId === row.orderId}
                  onClick={() => void resolveAddressMatch(row.orderId, 'reject')}
                >
                  Отклонить
                </AdminCompactBtn>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {deadTouches && deadTouches.count > 0 ? (
        <section className={styles.faqCard} style={{ marginBottom: 16 }}>
          <h2 className={pn.placementHeading}>
            Зависшие touch ({deadTouches.count})
          </h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {deadTouches.items.map((row) => (
              <li key={row.orderId} style={{ marginBottom: 8 }}>
                <Link href={`/admin/orders/${row.orderId}`}>
                  {row.orderNumber || shortUserId(row.orderId)}
                </Link>
                {' · '}
                {row.attempts} попыток
                {row.lastError ? ` — ${row.lastError.slice(0, 120)}` : ''}
                {' '}
                <AdminCompactBtn
                  type="button"
                  variant="outline"
                  disabled={deadBusyId === row.orderId}
                  onClick={() => void requeueDead(row.orderId)}
                >
                  {deadBusyId === row.orderId ? '…' : 'Retry'}
                </AdminCompactBtn>
              </li>
            ))}
          </ul>
        </section>
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
                  <option value="FIRST_GOODS_ORDER">
                    Только первый товарный заказ покупателя
                  </option>
                  <option value="EVERY">
                    Каждый оплаченный товарный заказ (+ окно ниже)
                  </option>
                </AdminSelect>
                <AdminTextField
                  label="EVERY: макс. заказов в окне (0 = без лимита)"
                  value={earnWindowMaxOrders}
                  onChange={(e) => {
                    setEarnWindowMaxOrders(e.target.value.replace(/\D/g, ''));
                    markDirty();
                  }}
                  inputMode="numeric"
                  disabled={earnMode !== 'EVERY'}
                />
                <AdminTextField
                  label="EVERY: окно от первой покупки, дни (0 = lifetime)"
                  value={earnWindowDays}
                  onChange={(e) => {
                    setEarnWindowDays(e.target.value.replace(/\D/g, ''));
                    markDirty();
                  }}
                  inputMode="numeric"
                  disabled={earnMode !== 'EVERY'}
                />
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
                <AdminTextField
                  label="Месячный cap начислений рефереру ₽ (0 = без лимита)"
                  value={monthlyEarnCapRub}
                  onChange={(e) => {
                    setMonthlyEarnCapRub(e.target.value.replace(/\D/g, ''));
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
                      e.target.value as
                        | 'DELIVERED'
                        | 'DAYS_AFTER_PAID'
                        | 'DELIVERED_PLUS_DAYS',
                    );
                    markDirty();
                  }}
                >
                  <option value="DELIVERED">Когда заказ «Доставлен»</option>
                  <option value="DELIVERED_PLUS_DAYS">
                    Через N дней после «Доставлен» (окно возврата)
                  </option>
                  <option value="DAYS_AFTER_PAID">
                    Через N дней после статуса «Оплачен»
                  </option>
                </AdminSelect>
                <AdminTextField
                  label={
                    quarantineMode === 'DELIVERED_PLUS_DAYS'
                      ? 'Дней после «Доставлен»'
                      : 'Дней после «Оплачен»'
                  }
                  value={quarantineDays}
                  onChange={(e) => {
                    setQuarantineDays(e.target.value.replace(/\D/g, ''));
                    markDirty();
                  }}
                  inputMode="numeric"
                  disabled={
                    quarantineMode !== 'DAYS_AFTER_PAID' &&
                    quarantineMode !== 'DELIVERED_PLUS_DAYS'
                  }
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

            <section className={styles.faqCard}>
              <h2 className={pn.placementHeading}>История изменений</h2>
              <AdminTabsLead>
                Снимок настроек до правки (% / режим / карантин и т.д.).
              </AdminTabsLead>
              {revisions.length === 0 ? (
                <p className={catalogStyles.lead}>Пока нет записей аудита.</p>
              ) : (
                <div className={catalogStyles.tableWrap}>
                  <table className={catalogStyles.table}>
                    <thead>
                      <tr>
                        <th>Когда</th>
                        <th>Кто</th>
                        <th>Было</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revisions.map((r) => (
                        <tr key={r.id}>
                          <td>{formatAdminDateTime(r.createdAt)}</td>
                          <td>{r.actorEmail || r.actorUserId || '—'}</td>
                          <td className={catalogStyles.muted}>
                            {r.snapshot.enabled ? 'вкл' : 'выкл'} ·{' '}
                            {r.snapshot.earnPercent}% · {r.snapshot.earnMode} ·{' '}
                            {r.snapshot.quarantineMode}
                            {r.snapshot.quarantineMode !== 'DELIVERED'
                              ? `/${r.snapshot.quarantineDays}д`
                              : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </form>
        </AdminTabsPanel>
      ) : null}

      {tab === 'funnel' ? (
        <AdminTabsPanel>
          <section className={styles.faqCard}>
            <h2 className={pn.placementHeading}>Воронка ?mf=</h2>
            <AdminTabsLead>
              Клик (beacon) → sticky/регистрация → заказ с attribution → оплата.
              Дни — календарь Europe/Moscow.
            </AdminTabsLead>
            <div className={styles.heroImages}>
              <AdminSelect
                label="Период"
                value={funnelPeriod}
                onChange={(e) =>
                  setFunnelPeriod(
                    e.target.value as 'today' | 'last_7' | 'month' | 'custom',
                  )
                }
              >
                <option value="today">Сегодня</option>
                <option value="last_7">7 дней</option>
                <option value="month">Этот месяц</option>
                <option value="custom">Свой период</option>
              </AdminSelect>
              {funnelPeriod === 'custom' ? (
                <>
                  <AdminTextField
                    label="С (YYYY-MM-DD)"
                    value={funnelFrom}
                    onChange={(e) => setFunnelFrom(e.target.value)}
                  />
                  <AdminTextField
                    label="По (YYYY-MM-DD)"
                    value={funnelTo}
                    onChange={(e) => setFunnelTo(e.target.value)}
                  />
                </>
              ) : null}
              <div className={styles.formActionsEnd}>
                <AdminCompactBtn
                  type="button"
                  variant="outline"
                  disabled={funnelLoading}
                  onClick={() => void loadFunnel()}
                >
                  {funnelLoading ? 'Загрузка…' : 'Обновить'}
                </AdminCompactBtn>
              </div>
            </div>
            {funnelError ? (
              <p className={catalogStyles.lead} role="alert">
                {funnelError}
              </p>
            ) : null}
            {funnel ? (
              <>
                <p className={styles.enabledAtMeta}>
                  {funnel.period.fromDate}
                  {funnel.period.fromDate !== funnel.period.toDate
                    ? ` — ${funnel.period.toDate}`
                    : ''}
                </p>
                <div className={styles.kpiGrid}>
                  <div className={styles.kpi}>
                    <div className={styles.kpiValue}>
                      {funnel.totals.visits.toLocaleString('ru-RU')}
                    </div>
                    <div>Клики</div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kpiValue}>
                      {funnel.totals.sticky.toLocaleString('ru-RU')}
                    </div>
                    <div>
                      Sticky{' '}
                      <span className={styles.kpiBadge}>
                        {formatRate(funnel.rates.visitToSticky)}
                      </span>
                    </div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kpiValue}>
                      {funnel.totals.orders.toLocaleString('ru-RU')}
                    </div>
                    <div>
                      Заказы{' '}
                      <span className={styles.kpiBadge}>
                        {formatRate(funnel.rates.stickyToOrder)}
                      </span>
                    </div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kpiValue}>
                      {funnel.totals.paid.toLocaleString('ru-RU')}
                    </div>
                    <div>
                      Оплачено{' '}
                      <span className={styles.kpiBadge}>
                        {formatRate(funnel.rates.orderToPaid)}
                      </span>
                    </div>
                  </div>
                </div>
                <p className={styles.enabledAtMeta}>
                  Клик → оплата: {formatRate(funnel.rates.visitToPaid)}
                </p>

                <h3 className={pn.placementHeading}>Топ кодов</h3>
                {funnel.topCodes.length === 0 ? (
                  <p className={catalogStyles.lead}>
                    Пока нет кликов за период. Откройте витрину с ?mf=CODE.
                  </p>
                ) : (
                  <div className={catalogStyles.tableWrap}>
                    <table className={catalogStyles.table}>
                      <thead>
                        <tr>
                          <th>Код</th>
                          <th>Реферер</th>
                          <th>Клики</th>
                          <th>Sticky</th>
                          <th>Заказы</th>
                          <th>Оплачено</th>
                        </tr>
                      </thead>
                      <tbody>
                        {funnel.topCodes.map((row) => (
                          <tr key={row.code}>
                            <td>
                              <code>{row.code}</code>
                            </td>
                            <td>
                              {row.referrerUserId ? (
                                <Link
                                  href={`/admin/users/${row.referrerUserId}`}
                                >
                                  {row.referrerEmail ?? shortUserId(row.referrerUserId)}
                                </Link>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>{row.visits.toLocaleString('ru-RU')}</td>
                            <td>{row.sticky.toLocaleString('ru-RU')}</td>
                            <td>{row.orders.toLocaleString('ru-RU')}</td>
                            <td>{row.paid.toLocaleString('ru-RU')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : funnelLoading ? (
              <p className={catalogStyles.lead}>Загрузка воронки…</p>
            ) : null}
          </section>
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
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setAppliedQ(refQ);
                    setRefOffset(0);
                    setRefNextOffset(null);
                    void loadReferrers({ q: refQ, offset: 0 });
                  }
                }}
              />
              <AdminSelect
                label="Сортировка"
                value={refSort}
                onChange={(e) => {
                  const next = e.target.value as ReferrerSort;
                  setRefSort(next);
                  setRefOffset(0);
                  setRefNextOffset(null);
                  void loadReferrers({ sort: next, offset: 0 });
                }}
              >
                <option value="earned">Earned</option>
                <option value="invitees">Приглашённые</option>
                <option value="gmv">GMV</option>
                <option value="id">ID</option>
              </AdminSelect>
              <AdminSelect
                label="Направление"
                value={refDir}
                onChange={(e) => {
                  const next = e.target.value as 'asc' | 'desc';
                  setRefDir(next);
                  setRefOffset(0);
                  setRefNextOffset(null);
                  void loadReferrers({ dir: next, offset: 0 });
                }}
              >
                <option value="desc">По убыванию</option>
                <option value="asc">По возрастанию</option>
              </AdminSelect>
              <div className={styles.formActionsEnd}>
                <AdminCompactBtn
                  type="button"
                  variant="outline"
                  disabled={refLoading}
                  onClick={() => {
                    setAppliedQ(refQ);
                    setRefOffset(0);
                    setRefNextOffset(null);
                    void loadReferrers({ q: refQ, offset: 0 });
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
                      <th>Пригл.</th>
                      <th>GMV</th>
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
                      <th>Пригл.</th>
                      <th>GMV</th>
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
                        <td>{(r.invitees ?? 0).toLocaleString('ru-RU')}</td>
                        <td>{formatAdminMoney(r.gmv ?? 0)}</td>
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
            {refNextOffset != null && !searchDirty && referrers.length > 0 ? (
              <AdminCompactBtn
                type="button"
                variant="outline"
                disabled={refLoading}
                onClick={() =>
                  void loadReferrers({
                    append: true,
                    offset: refNextOffset,
                  })
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
            ? `Код ${confirm.row.referralCode} будет заменён.`
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
      >
        {confirm?.type === 'regenerate' ? (
          <label className={styles.activeLabel}>
            <AdminCheckbox
              checked={regenKeepGrace}
              onChange={(e) => setRegenKeepGrace(e.target.checked)}
            />
            Оставить старые ?mf= на срок TTL (grace). Снимите галочку при
            утечке на агрегатор — aliases отзываются сразу.
          </label>
        ) : null}
      </AdminConfirmDialog>
    </div>
  );
}
