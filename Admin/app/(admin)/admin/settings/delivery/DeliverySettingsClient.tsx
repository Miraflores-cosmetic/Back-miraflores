'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { useToast } from '@/components/Toast/ToastProvider';
import { AdminBackendRequestError, adminBackendJson } from '@/lib/adminBackendFetch';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';
import styles from './delivery.module.css';
import { CdekSettingsCard } from './CdekSettingsCard';
import { OzonCatalogDimsCard } from './OzonCatalogDimsCard';
import { OzonHealthCard } from './OzonHealthCard';
import { OzonTariffCard } from './OzonTariffCard';

type OzonStatus = {
  mode: 'oauth' | 'api-key' | 'none';
  appConfigured: boolean;
  connected: boolean;
  redirectUri: string | null;
  scope: string;
  connectedAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
};

const BASE = 'delivery/ozon/admin';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function authLabel(mode: OzonStatus['mode']): string {
  if (mode === 'oauth') return 'OAuth';
  if (mode === 'api-key') return 'API-ключ';
  return '—';
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof AdminBackendRequestError ? e.message : fallback;
}

function OzonOAuthFacts({
  status,
  onCopyRedirect,
}: {
  status: OzonStatus;
  onCopyRedirect: () => void;
}) {
  return (
    <dl className={styles.facts}>
      <div className={styles.fact}>
        <dt>Scope</dt>
        <dd>
          <code>{status.scope}</code>
        </dd>
      </div>
      <div className={`${styles.fact} ${styles.factWide}`}>
        <dt>Redirect URI</dt>
        <dd className={styles.redirectRow}>
          <code className={styles.redirectCode}>{status.redirectUri ?? 'не задан'}</code>
          {status.redirectUri ? (
            <AdminCompactBtn type="button" variant="outline" onClick={() => void onCopyRedirect()}>
              Копировать
            </AdminCompactBtn>
          ) : null}
        </dd>
      </div>
    </dl>
  );
}

export function DeliverySettingsClient() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<OzonStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'connect' | 'test' | 'disconnect'>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [healthKey, setHealthKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setStatus(await adminBackendJson<OzonStatus>(`${BASE}/status`));
      setLoadError(null);
    } catch (e) {
      setLoadError(errMessage(e, 'Не удалось загрузить статус Ozon'));
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  useEffect(() => {
    const flag = searchParams.get('ozon');
    if (flag === 'connected') showToast('Ozon Доставка подключена');
    if (flag === 'error') setCallbackError(searchParams.get('message') || 'Ошибка авторизации Ozon');
  }, [searchParams, showToast]);

  async function connect() {
    const popup = window.open('', '_blank');
    setBusy('connect');
    try {
      const { url } = await adminBackendJson<{ url: string }>(`${BASE}/authorize-url`, {
        method: 'POST',
      });
      if (popup) {
        popup.opener = null;
        popup.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (e) {
      popup?.close();
      showToast(errMessage(e, 'Не удалось получить ссылку авторизации'));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    setTestResult(null);
    try {
      const res = await adminBackendJson<{ ok: boolean; pointCount: number | null; error: string | null }>(
        `${BASE}/test`,
        { method: 'POST' },
      );
      if (res.ok) {
        setTestResult(
          `API работает: в справочнике ${(res.pointCount ?? 0).toLocaleString('ru-RU')} пунктов выдачи`,
        );
      } else {
        showToast(res.error ? `Проверка не прошла: ${res.error}` : 'Проверка не прошла');
      }
    } catch (e) {
      showToast(errMessage(e, 'Проверка не прошла'));
    } finally {
      setBusy(null);
      setHealthKey((k) => k + 1);
      void load();
    }
  }

  async function disconnect() {
    if (!window.confirm('Отключить Ozon Доставку? Покупатели не смогут выбрать пункты Ozon.')) return;
    setBusy('disconnect');
    try {
      setStatus(await adminBackendJson<OzonStatus>(`${BASE}/disconnect`, { method: 'POST' }));
      setTestResult(null);
      showToast('Ozon отключён');
    } catch (e) {
      showToast(errMessage(e, 'Не удалось отключить'));
    } finally {
      setBusy(null);
    }
  }

  async function copyRedirect() {
    if (!status?.redirectUri) return;
    try {
      await navigator.clipboard.writeText(status.redirectUri);
      showToast('Redirect URI скопирован');
    } catch {
      showToast('Не удалось скопировать');
    }
  }

  const pill = !status
    ? null
    : status.connected
      ? { cls: styles.pillOk, text: 'Подключено' }
      : status.lastError
        ? { cls: styles.pillError, text: 'Требуется переподключение' }
        : { cls: styles.pillIdle, text: 'Не подключено' };

  const oauthMode = status?.mode === 'oauth';

  return (
    <div className={`${catalogStyles.form} ${catalogStyles.formWide} ${styles.page}`}>
      <div className={pn.stickyToolbar}>
        <div className={pn.stickyToolbarMain}>
          <div className={pn.stickyToolbarNav}>
            <AdminCompactBtnLink href="/admin/settings" variant="outline">
              ← Настройки
            </AdminCompactBtnLink>
          </div>
          <h1 className={pn.stickyToolbarTitle}>Службы доставки</h1>
        </div>
      </div>

      {loadError ? (
        <div className={catalogStyles.errorBanner} role="alert">
          <span>{loadError}</span>
          <AdminCompactBtn type="button" variant="outline" onClick={() => void load()}>
            Повторить
          </AdminCompactBtn>
        </div>
      ) : null}

      <CdekSettingsCard />

      <section className={styles.card}>
        <header className={styles.cardHead}>
          <span className={styles.logo} aria-hidden>
            O
          </span>
          <div className={styles.cardHeadText}>
            <h2 className={styles.cardTitle}>Ozon Доставка</h2>
            <p className={styles.cardSub}>Дополнительный перевозчик: ПВЗ и курьер Ozon на checkout</p>
          </div>
          {pill ? <span className={`${styles.pill} ${pill.cls}`}>{pill.text}</span> : null}
        </header>

        {!status && !loadError ? <p className={catalogStyles.lead}>Загрузка…</p> : null}

        {status ? (
          <>
            {callbackError ? (
              <div className={catalogStyles.errorBanner} role="alert">
                <span>Ozon: {callbackError}</span>
              </div>
            ) : null}
            {status.lastError && !status.connected ? (
              <div className={catalogStyles.errorBanner} role="alert">
                <span>Последняя ошибка: {status.lastError}</span>
              </div>
            ) : null}
            {oauthMode && !status.appConfigured ? (
              <div className={catalogStyles.warningBanner} role="status">
                <span>
                  Для OAuth на API нужны <code>OZON_CLIENT_ID</code> и <code>OZON_CLIENT_SECRET</code>.
                </span>
              </div>
            ) : null}

            {status.connected ? (
              <p className={styles.metaLine}>
                {authLabel(status.mode)} · подключено {formatDate(status.connectedAt)} · токен{' '}
                {formatDate(status.lastRefreshAt)}
              </p>
            ) : status.mode === 'api-key' ? (
              <p className={styles.metaLine}>Авторизация API-ключом на сервере (OAuth не используется)</p>
            ) : null}

            {testResult ? <p className={styles.testOk}>{testResult}</p> : null}

            <div className={styles.actions}>
              {oauthMode ? (
                <AdminCompactBtn
                  type="button"
                  variant="accent"
                  disabled={busy !== null || !status.appConfigured}
                  onClick={() => void connect()}
                >
                  {busy === 'connect'
                    ? 'Открываем Ozon…'
                    : status.connected
                      ? 'Переподключить'
                      : 'Подключить Ozon'}
                </AdminCompactBtn>
              ) : null}
              <AdminCompactBtn
                type="button"
                variant="outline"
                disabled={busy !== null || !status.connected}
                onClick={() => void test()}
              >
                {busy === 'test' ? 'Проверяем…' : 'Проверить API'}
              </AdminCompactBtn>
              {oauthMode ? (
                <AdminCompactBtn
                  type="button"
                  variant="danger"
                  disabled={busy !== null}
                  onClick={() => void disconnect()}
                >
                  Отключить
                </AdminCompactBtn>
              ) : null}
            </div>

            {!status.connected && oauthMode ? (
              <details className={styles.advancedBlock} open>
                <summary className={styles.advancedSummary}>Как подключить OAuth</summary>
                <div className={styles.advancedInner}>
                  <OzonOAuthFacts status={status} onCopyRedirect={() => void copyRedirect()} />
                  <ol className={styles.steps}>
                    <li>
                      В dev.ozon.ru укажите Redirect URI из блока выше и scope{' '}
                      <code>{status.scope}</code>.
                    </li>
                    <li>«Подключить Ozon» → вход в кабинет продавца → разрешить доступ.</li>
                    <li>«Проверить API» — должен загрузиться справочник ПВЗ.</li>
                  </ol>
                </div>
              </details>
            ) : null}

            {status.connected && oauthMode ? (
              <details className={styles.advancedBlock}>
                <summary className={styles.advancedSummary}>OAuth и redirect URI</summary>
                <div className={styles.advancedInner}>
                  <OzonOAuthFacts status={status} onCopyRedirect={() => void copyRedirect()} />
                </div>
              </details>
            ) : null}

            {status.connected ? (
              <p className={styles.hint}>
                Тариф на checkout — своя сетка (см. блок ниже). Отправления создаются в кабинете Ozon, трек —
                в{' '}
                <Link href="/admin/orders">карточке заказа</Link>. Порог бесплатной доставки — в{' '}
                <Link href="/admin/cart">корзине</Link>.
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      {status ? (
        <details className={styles.advancedBlock}>
          <summary className={styles.advancedSummary}>Ozon: тариф, габариты каталога, мониторинг</summary>
          <div className={`${styles.advancedInner} ${styles.advancedStack}`}>
            {status.connected || status.connectedAt ? <OzonHealthCard reloadKey={healthKey} /> : null}
            <OzonTariffCard />
            <OzonCatalogDimsCard />
          </div>
        </details>
      ) : null}
    </div>
  );
}
