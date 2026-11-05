'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminRichField } from '@/components/admin/AdminRichField/AdminRichField';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
  adminBackendPath,
} from '@/lib/adminBackendFetch';
import {
  CART_SETTINGS_DEFAULTS,
  CART_THRESHOLD_MAX_RUB,
  normalizeCartSettings,
  type CartSettings,
} from '@/lib/cartSettings';
import { formatRub } from '@/lib/publicCatalog';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';
import cartPreview from './cartAdmin.module.css';

const BACK_HREF = '/admin/settings';

type CartApi = CartSettings & { id?: string | null; updatedAt?: string | null };

function discardSessionUploads(urls: string[]) {
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (!unique.length) return;
  const body = JSON.stringify({ urls: unique });
  try {
    void fetch(adminBackendPath('settings/admin/cart/discard-uploads'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    /* best-effort */
  }
}

function mediaUrlsFromHtml(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/src=["']([^"']+)["']/gi)) {
    const u = m[1]?.trim();
    if (u) out.push(u);
  }
  return out;
}

export function CartAdminClient() {
  const { showToast } = useToast();
  const sessionUploadsRef = useRef<Set<string>>(new Set());
  const savedMediaRef = useRef<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [loadedOk, setLoadedOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(
    String(CART_SETTINGS_DEFAULTS.freeShippingThresholdRub),
  );
  const [contentText, setContentText] = useState(
    CART_SETTINGS_DEFAULTS.progressContentText,
  );
  const [successText, setSuccessText] = useState(
    CART_SETTINGS_DEFAULTS.progressSuccessText,
  );
  const [legalHtml, setLegalHtml] = useState(CART_SETTINGS_DEFAULTS.legalHtml);
  const [sampleRulesSlug, setSampleRulesSlug] = useState(
    CART_SETTINGS_DEFAULTS.sampleRulesArticleSlug ?? '',
  );
  const [sampleNoticeHtml, setSampleNoticeHtml] = useState(
    CART_SETTINGS_DEFAULTS.sampleVariantNoticeHtml ?? '',
  );
  const [sampleRulesArticleExists, setSampleRulesArticleExists] = useState(true);
  const [previewSum, setPreviewSum] = useState(
    String(Math.round(CART_SETTINGS_DEFAULTS.freeShippingThresholdRub * 0.6)),
  );

  const markDirty = useCallback(() => setDirty(true), []);

  function trackUpload(url: string) {
    const t = url.trim();
    if (!t) return;
    sessionUploadsRef.current.add(t);
  }

  function markSavedMedia(html: string) {
    const kept = new Set(mediaUrlsFromHtml(html));
    savedMediaRef.current = kept;
    for (const u of kept) sessionUploadsRef.current.delete(u);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setActionError(null);
    setLoadedOk(false);
    try {
      const raw = await adminBackendJson<CartApi>('settings/admin/cart');
      const data = normalizeCartSettings(raw);
      const html = data.legalHtml || CART_SETTINGS_DEFAULTS.legalHtml;
      setThreshold(String(data.freeShippingThresholdRub));
      setContentText(data.progressContentText);
      setSuccessText(data.progressSuccessText);
      setLegalHtml(html);
      setSampleRulesSlug(data.sampleRulesArticleSlug ?? '');
      setSampleNoticeHtml(data.sampleVariantNoticeHtml ?? '');
      setSampleRulesArticleExists(data.sampleRulesArticleExists !== false);
      setPreviewSum(String(Math.round(data.freeShippingThresholdRub * 0.6)));
      markSavedMedia(html);
      sessionUploadsRef.current.clear();
      setLoadedOk(true);
      setDirty(false);
    } catch (e) {
      setLoadedOk(false);
      setLoadError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      const orphans = [...sessionUploadsRef.current].filter(
        (u) => !savedMediaRef.current.has(u),
      );
      discardSessionUploads(orphans);
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const thresholdRub = useMemo(() => {
    const n = Number.parseInt(threshold.replace(/\s/g, ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : CART_SETTINGS_DEFAULTS.freeShippingThresholdRub;
  }, [threshold]);

  const mockSum = useMemo(() => {
    const n = Number.parseInt(previewSum.replace(/\s/g, ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [previewSum]);

  const remainder = Math.max(0, thresholdRub - mockSum);
  const progressPercent =
    thresholdRub > 0 ? Math.min(100, (mockSum / thresholdRub) * 100) : 0;
  const progressReached = remainder <= 0;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!loadedOk) return;

    const rub = Number.parseInt(threshold.replace(/\s/g, ''), 10);
    if (!Number.isFinite(rub) || rub < 0) {
      showToast('Укажите порог в рублях (целое число ≥ 0)');
      return;
    }
    if (rub > CART_THRESHOLD_MAX_RUB) {
      showToast(`Порог слишком большой (макс. ${CART_THRESHOLD_MAX_RUB.toLocaleString('ru-RU')} ₽)`);
      return;
    }
    if (!contentText.trim() || !successText.trim()) {
      showToast('Заполните оба текста progress-bar');
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      const raw = await adminBackendJson<CartApi>('settings/admin/cart', {
        method: 'PUT',
        body: JSON.stringify({
          freeShippingThresholdRub: rub,
          progressContentText: contentText.trim(),
          progressSuccessText: successText.trim(),
          legalHtml: legalHtml.trim() || '<p></p>',
          sampleRulesArticleSlug: sampleRulesSlug.trim() || null,
          sampleVariantNoticeHtml: sampleNoticeHtml.trim() || null,
        }),
      });
      const data = normalizeCartSettings(raw);
      const html = data.legalHtml || CART_SETTINGS_DEFAULTS.legalHtml;
      setThreshold(String(data.freeShippingThresholdRub));
      setContentText(data.progressContentText);
      setSuccessText(data.progressSuccessText);
      setLegalHtml(html);
      setSampleRulesSlug(data.sampleRulesArticleSlug ?? '');
      setSampleNoticeHtml(data.sampleVariantNoticeHtml ?? '');
      setSampleRulesArticleExists(data.sampleRulesArticleExists !== false);
      const leftovers = [...sessionUploadsRef.current];
      markSavedMedia(html);
      discardSessionUploads(leftovers.filter((u) => !savedMediaRef.current.has(u)));
      setDirty(false);
      showToast('Корзина сохранена');
    } catch (err) {
      const msg =
        err instanceof AdminBackendRequestError ? err.message : 'Ошибка сохранения';
      setActionError(msg);
      showToast(msg);
    } finally {
      setSaving(false);
    }
  }

  const canSave = loadedOk && !loading && dirty && !saving;

  if (loading) {
    return <p className={catalogStyles.lead}>Загрузка…</p>;
  }

  return (
    <form
      onSubmit={(e) => void onSave(e)}
      className={`${catalogStyles.form} ${catalogStyles.formWide}`}
    >
      <div className={pn.stickyToolbar}>
        <div className={pn.stickyToolbarMain}>
          <div className={pn.stickyToolbarNav}>
            <AdminCompactBtnLink href={BACK_HREF} variant="outline">
              ← Настройки
            </AdminCompactBtnLink>
            {dirty ? (
              <span className={pn.dirtyHintInline}>Несохранённые изменения</span>
            ) : null}
          </div>
          <h1 className={pn.stickyToolbarTitle}>Корзина</h1>
        </div>
        <div className={pn.stickyToolbarActions}>
          <AdminCompactBtn type="submit" variant="accent" disabled={!canSave}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </AdminCompactBtn>
        </div>
      </div>

      <p className={catalogStyles.lead}>
        Progress-bar в модальной корзине и информационный текст (accordion). Порог ниже влияет
        только на шкалу «до бесплатной доставки» в UI корзины — тариф доставки на checkout
        считается отдельно.
      </p>

      {loadError ? (
        <div className={catalogStyles.errorBanner} role="alert">
          <span>{loadError}</span>
          <AdminCompactBtn type="button" variant="outline" onClick={() => void load()}>
            Повторить
          </AdminCompactBtn>
          <button
            type="button"
            className={catalogStyles.errorBannerDismiss}
            onClick={() => setLoadError(null)}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div className={catalogStyles.errorBanner} role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className={catalogStyles.errorBannerDismiss}
            onClick={() => setActionError(null)}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
      ) : null}

      {!loadedOk ? (
        <p className={catalogStyles.lead}>
          Не удалось загрузить настройки. Сохранение отключено.
        </p>
      ) : (
        <>
          <p className={catalogStyles.lead}>Progress-bar</p>
          <AdminTextField
            label="Порог progress-bar, ₽ (не тариф доставки)"
            value={threshold}
            onChange={(e) => {
              markDirty();
              setThreshold(e.target.value);
            }}
            inputMode="numeric"
            disabled={saving}
            max={CART_THRESHOLD_MAX_RUB}
          />
          <p className={catalogStyles.cardNote}>
            Максимум {CART_THRESHOLD_MAX_RUB.toLocaleString('ru-RU')} ₽
          </p>
          <AdminTextField
            label="Текст до порога (после суммы остатка)"
            value={contentText}
            onChange={(e) => {
              markDirty();
              setContentText(e.target.value);
            }}
            disabled={saving}
            maxLength={500}
          />
          <AdminTextField
            label="Текст при достижении порога"
            value={successText}
            onChange={(e) => {
              markDirty();
              setSuccessText(e.target.value);
            }}
            disabled={saving}
            maxLength={500}
          />

          <div className={cartPreview.previewBlock}>
            <p className={catalogStyles.lead} style={{ marginBottom: 8 }}>
              Превью бара
            </p>
            <AdminTextField
              label="Мок суммы корзины, ₽"
              value={previewSum}
              onChange={(e) => setPreviewSum(e.target.value)}
              inputMode="numeric"
            />
            <input
              className={cartPreview.previewRange}
              type="range"
              min={0}
              max={Math.max(thresholdRub, 1)}
              step={Math.max(1, Math.round(Math.max(thresholdRub, 1) / 100))}
              value={Math.min(mockSum, Math.max(thresholdRub, 1))}
              onChange={(e) => setPreviewSum(e.target.value)}
              aria-label="Мок суммы корзины"
            />
            <div className={cartPreview.progressBlock} aria-live="polite">
              <p className={cartPreview.progressText}>
                {progressReached
                  ? successText.trim() || CART_SETTINGS_DEFAULTS.progressSuccessText
                  : `${formatRub(remainder)} ${contentText.trim() || CART_SETTINGS_DEFAULTS.progressContentText}`}
              </p>
              <div className={cartPreview.progressTrack}>
                <div
                  className={cartPreview.progressFill}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>

          <p className={catalogStyles.lead}>Пробники</p>
          <AdminTextField
            label="Slug статьи «Правила приобретения пробников»"
            value={sampleRulesSlug}
            onChange={(e) => {
              markDirty();
              setSampleRulesSlug(e.target.value);
            }}
            disabled={saving}
            maxLength={200}
          />
          <p className={catalogStyles.cardNote}>
            Страница на витрине: /articles/[slug]
          </p>
          {!sampleRulesArticleExists ? (
            <p className={catalogStyles.cardNote} role="alert">
              Статья не найдена или не опубликована — ссылка на витрине будет недоступна.
              Создайте запись в блоге или укажите другой slug (пустое поле — дефолт{' '}
              {CART_SETTINGS_DEFAULTS.sampleRulesArticleSlug}).
            </p>
          ) : null}
          <AdminRichField
            label="Текст под описанием пробника на карточке товара"
            value={sampleNoticeHtml}
            onChange={(v) => {
              markDirty();
              setSampleNoticeHtml(v);
            }}
            onUploaded={trackUpload}
            tall
            disabled={saving}
          />

          <p className={catalogStyles.lead}>Текст в корзине</p>
          <AdminRichField
            label="Legal / info (accordion)"
            value={legalHtml}
            onChange={(v) => {
              markDirty();
              setLegalHtml(v);
            }}
            onUploaded={trackUpload}
            tall
            disabled={saving}
          />
        </>
      )}
    </form>
  );
}
