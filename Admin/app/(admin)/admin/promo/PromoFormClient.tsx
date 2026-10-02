'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { adminConfirm } from '@/components/admin/AdminModal/adminConfirm';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminPillChip, AdminPillChipList } from '@/components/AdminPillChip/AdminPillChip';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import { AdminSelect, AdminTextField } from '@/components/AdminTextField/AdminTextField';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime } from '@/lib/adminFormat';
import type { AdminPromoCode, PromoScope, PromoType } from '@/lib/adminPromoTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import {
  DiscountCategoryPickerModal,
  DiscountProductPickerModal,
} from '@/app/(admin)/admin/discounts/DiscountScopePickerModal';
import { DISCOUNT_CATEGORY_NO_DESCENDANTS_HINT } from '@/app/(admin)/admin/discounts/discountHints';

const REDEMPTIONS_LIMIT = 20;

type ScopeTab = 'ALL' | PromoScope;

function parseMoscowParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '00:00' };
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
    const time = d.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return { date, time };
  } catch {
    return { date: '', time: '00:00' };
  }
}

function combineMoscowDateTime(ymd: string, hm: string): string | null {
  if (!ymd.trim()) return null;
  const [hRaw, mRaw] = hm.split(':');
  const h = String(Number(hRaw) || 0).padStart(2, '0');
  const m = String(Number(mRaw) || 0).padStart(2, '0');
  return `${ymd}T${h}:${m}:00.000+03:00`;
}

function optionalInt(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n) || n < 1) throw new Error('Лимиты: целое ≥ 1 или пусто');
  return n;
}

export function PromoFormClient({ promoId }: { promoId?: string }) {
  const router = useRouter();
  const isEdit = Boolean(promoId);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminPromoCode | null>(null);
  const [redemptionsPage, setRedemptionsPage] = useState(1);

  const [code, setCode] = useState('');
  const [type, setType] = useState<PromoType>('PERCENT');
  const [value, setValue] = useState('10');
  const [active, setActive] = useState(true);
  const [oneShot, setOneShot] = useState(false);
  const [maxUses, setMaxUses] = useState('');
  const [minOrderAmount, setMinOrderAmount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('00:00');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('23:59');

  const [scopeTab, setScopeTab] = useState<ScopeTab>('ALL');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [productIds, setProductIds] = useState<string[]>([]);
  const [productLabels, setProductLabels] = useState<Record<string, string>>({});
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [prodModalOpen, setProdModalOpen] = useState(false);

  const applyDetail = useCallback((row: AdminPromoCode) => {
    setDetail(row);
    setCode(row.code);
    setType(row.type === 'FIXED' ? 'FIXED' : 'PERCENT');
    setValue(String(row.value));
    setActive(row.active);
    setOneShot(row.oneShot ?? false);
    setMaxUses(row.maxUses != null ? String(row.maxUses) : '');
    setMinOrderAmount(row.minOrderAmount != null ? String(row.minOrderAmount) : '');
    const s = parseMoscowParts(row.startsAt);
    const e = parseMoscowParts(row.endsAt);
    setStartDate(s.date);
    setStartTime(s.time);
    setEndDate(e.date);
    setEndTime(e.time);

    setScopeTab(row.scope ?? 'ALL');
    setCategoryIds(row.categoryIds ?? []);
    setCategoryLabels(
      Object.fromEntries(
        (row.categories ?? []).map((c) => [
          c.id,
          c.parentName ? `${c.parentName} → ${c.name}` : c.name,
        ]),
      ),
    );
    setProductIds(row.productIds ?? []);
    setProductLabels(
      Object.fromEntries((row.products ?? []).map((p) => [p.id, p.name])),
    );
  }, []);

  useEffect(() => {
    if (!promoId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams({
          redemptionsPage: String(redemptionsPage),
          redemptionsLimit: String(REDEMPTIONS_LIMIT),
        });
        const row = await adminBackendJson<AdminPromoCode>(
          `promo/admin/${promoId}?${sp}`,
        );
        if (cancelled) return;
        applyDetail(row);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [promoId, redemptionsPage, applyDetail]);

  async function changeScopeTab(next: ScopeTab) {
    if (next === scopeTab) return;
    const clearingProducts = next !== 'PRODUCTS' && productIds.length > 0;
    const clearingCategories = next !== 'CATEGORY' && categoryIds.length > 0;
    if (clearingProducts || clearingCategories) {
      const ok = await adminConfirm({
        title: 'Сменить область',
        message:
          next === 'ALL'
            ? 'Сменить на весь заказ? Выбор категорий и товаров будет очищен.'
            : next === 'CATEGORY'
              ? 'Сменить область на категории? Выбор товаров будет очищен.'
              : 'Сменить область на товары? Выбор категорий будет очищен.',
        confirmLabel: 'Сменить',
      });
      if (!ok) return;
    }
    if (next !== 'PRODUCTS') {
      setProductIds([]);
      setProductLabels({});
    }
    if (next !== 'CATEGORY') {
      setCategoryIds([]);
      setCategoryLabels({});
    }
    setScopeTab(next);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const n = Math.floor(Number(value));
      if (!code.trim()) throw new Error('Укажите код');
      if (!Number.isFinite(n) || n < 1) throw new Error('Значение: целое число ≥ 1');
      if (type === 'PERCENT' && n > 100) throw new Error('PERCENT: максимум 100');
      if (scopeTab === 'CATEGORY' && categoryIds.length === 0) {
        throw new Error('Выберите категорию или подкатегорию');
      }
      if (scopeTab === 'PRODUCTS' && productIds.length === 0) {
        throw new Error('Выберите хотя бы один товар');
      }

      const body = {
        code: code.trim().toUpperCase(),
        type,
        value: n,
        active,
        oneShot,
        maxUses: optionalInt(maxUses),
        minOrderAmount: optionalInt(minOrderAmount),
        startsAt: combineMoscowDateTime(startDate, startTime),
        endsAt: combineMoscowDateTime(endDate, endTime),
        scope: scopeTab === 'ALL' ? null : scopeTab,
        categoryIds: scopeTab === 'CATEGORY' ? categoryIds : [],
        productIds: scopeTab === 'PRODUCTS' ? productIds : [],
      };

      if (!isEdit) {
        const created = await adminBackendJson<AdminPromoCode>('promo/admin', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        router.replace(`/admin/promo/${created.id}`);
        router.refresh();
        return;
      }

      const updated = await adminBackendJson<AdminPromoCode>(`promo/admin/${promoId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      applyDetail(updated);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof AdminBackendRequestError || err instanceof Error
          ? err.message
          : 'Не удалось сохранить',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading && !detail) return <p className={styles.muted}>Загрузка…</p>;

  const redemptions = detail?.redemptions ?? [];
  const redemptionsTotal = detail?.redemptionsTotal ?? 0;

  return (
    <>
      <form onSubmit={(e) => void onSave(e)} className={styles.form}>
        <p className={styles.backRow}>
          <AdminCompactBtnLink href="/admin/promo" variant="outline">
            ← К списку
          </AdminCompactBtnLink>
        </p>
        <div className={styles.detailTitleRow}>
          <h1 className={styles.title}>{isEdit ? 'Промокод' : 'Новый промокод'}</h1>
          <div className={styles.detailTitleActions}>
            <AdminCompactBtn type="submit" variant="accent" disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </AdminCompactBtn>
          </div>
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <AdminTextField
          label="Код"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          required
          placeholder="SALE10"
          autoComplete="off"
          spellCheck={false}
        />

        <AdminSelect
          label="Тип"
          value={type}
          onChange={(e) => setType(e.target.value as PromoType)}
        >
          <option value="PERCENT">Процент</option>
          <option value="FIXED">Фикс (₽)</option>
        </AdminSelect>

        <AdminTextField
          label={type === 'PERCENT' ? 'Процент (1–100)' : 'Сумма скидки (₽)'}
          type="number"
          min={1}
          max={type === 'PERCENT' ? 100 : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Настройка области</h2>
          <AdminTabs
            ariaLabel="Область промокода"
            variant="underline"
            compact
            activeId={scopeTab}
            onChange={(id) => void changeScopeTab(id as ScopeTab)}
            items={[
              { id: 'ALL', label: 'Весь заказ' },
              { id: 'CATEGORY', label: 'Категория / подкатегория' },
              { id: 'PRODUCTS', label: 'Конкретные товары' },
            ]}
          />
          {scopeTab === 'CATEGORY' ? (
            <p className={styles.muted}>{DISCOUNT_CATEGORY_NO_DESCENDANTS_HINT}</p>
          ) : null}
          {scopeTab === 'ALL' ? (
            <p className={styles.muted}>
              Скидка считается от суммы всех товаров в корзине (без доставки).
            </p>
          ) : null}

          {scopeTab === 'CATEGORY' ? (
            <div className={styles.pickerStack}>
              <AdminCompactBtn
                type="button"
                variant="outline"
                onClick={() => setCatModalOpen(true)}
              >
                Выбрать категории…
              </AdminCompactBtn>
              {categoryIds.length === 0 ? (
                <p className={styles.muted}>Ничего не выбрано</p>
              ) : (
                <AdminPillChipList aria-label="Выбранные категории">
                  {categoryIds.map((id) => {
                    const label = categoryLabels[id] ?? id;
                    return (
                      <AdminPillChip
                        key={id}
                        onRemove={() =>
                          setCategoryIds((prev) => prev.filter((x) => x !== id))
                        }
                        removeAriaLabel={`Убрать «${label}»`}
                      >
                        {label}
                      </AdminPillChip>
                    );
                  })}
                </AdminPillChipList>
              )}
            </div>
          ) : null}

          {scopeTab === 'PRODUCTS' ? (
            <div className={styles.pickerStack}>
              <AdminCompactBtn
                type="button"
                variant="outline"
                onClick={() => setProdModalOpen(true)}
              >
                Выбрать товары…
              </AdminCompactBtn>
              {productIds.length === 0 ? (
                <p className={styles.muted}>Ничего не выбрано</p>
              ) : (
                <AdminPillChipList aria-label="Выбранные товары">
                  {productIds.map((id) => {
                    const label = productLabels[id] ?? id;
                    return (
                      <AdminPillChip
                        key={id}
                        onRemove={() =>
                          setProductIds((prev) => prev.filter((x) => x !== id))
                        }
                        removeAriaLabel={`Убрать «${label}»`}
                      >
                        {label}
                      </AdminPillChip>
                    );
                  })}
                </AdminPillChipList>
              )}
            </div>
          ) : null}
        </section>

        <label className={styles.labelCheckboxRow} htmlFor="promo-active">
          <AdminCheckbox
            id="promo-active"
            className={styles.adminCheckboxForm}
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Активен
        </label>
        <label className={styles.labelCheckboxRow} htmlFor="promo-oneshot">
          <AdminCheckbox
            id="promo-oneshot"
            className={styles.adminCheckboxForm}
            checked={oneShot}
            onChange={(e) => setOneShot(e.target.checked)}
          />
          One-shot (один раз на email / guest)
        </label>

        <AdminTextField
          label="Max uses (пусто = без лимита)"
          type="number"
          min={1}
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
        />
        <AdminTextField
          label={
            scopeTab === 'ALL'
              ? 'Мин. сумма заказа ₽ (опц.)'
              : 'Мин. сумма области ₽ (опц.)'
          }
          type="number"
          min={1}
          value={minOrderAmount}
          onChange={(e) => setMinOrderAmount(e.target.value)}
        />
        {minOrderAmount.trim() ? (
          <p className={styles.muted}>
            {scopeTab === 'ALL'
              ? 'Порог по сумме всех товаров в корзине (без доставки).'
              : 'Порог по сумме только выбранных категорий/товаров — той же базы, с которой считается скидка.'}
          </p>
        ) : null}

        <AdminTextField
          label="Начало (дата МСК, опц.)"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <AdminTextField
          label="Время начала"
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />
        <AdminTextField
          label="Конец (дата МСК, опц.)"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <AdminTextField
          label="Время конца"
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
        />
        <p className={styles.muted}>
          FIXED — рубли. Checkout пересчитывает сумму на сервере и пишет redemption.
          {detail?.usedCount != null
            ? ` Активных применений (не отменённых): ${detail.usedCount}.`
            : ''}
        </p>
      </form>

      <DiscountCategoryPickerModal
        open={catModalOpen}
        selectedIds={categoryIds}
        onClose={() => setCatModalOpen(false)}
        onApply={(ids, labels) => {
          setCategoryIds(ids);
          setCategoryLabels((prev) => ({ ...prev, ...labels }));
        }}
      />
      <DiscountProductPickerModal
        open={prodModalOpen}
        selectedIds={productIds}
        selectedLabels={productLabels}
        onClose={() => setProdModalOpen(false)}
        onApply={(ids, labels) => {
          setProductIds(ids);
          setProductLabels(labels);
        }}
      />

      {isEdit ? (
        <section className={styles.section} style={{ marginTop: 32 }}>
          <h2 className={styles.sectionTitle}>История применений</h2>
          {redemptions.length === 0 && redemptionsTotal === 0 ? (
            <p className={styles.muted}>Пока нет применений</p>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Когда</th>
                      <th>Заказ</th>
                      <th>Статус</th>
                      <th>Email</th>
                      <th>Скидка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redemptions.map((r) => (
                      <tr key={r.id}>
                        <td className={styles.mutedInline}>
                          {formatAdminDateTime(r.createdAt)}
                        </td>
                        <td>{r.order?.number ?? r.orderId}</td>
                        <td className={styles.mutedInline}>{r.order?.status ?? '—'}</td>
                        <td className={styles.mutedInline}>{r.email ?? '—'}</td>
                        <td>{r.discountAmount} ₽</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {redemptionsTotal > REDEMPTIONS_LIMIT ? (
                <AdminListPagination
                  page={redemptionsPage}
                  total={redemptionsTotal}
                  limit={REDEMPTIONS_LIMIT}
                  onPageChange={setRedemptionsPage}
                />
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
