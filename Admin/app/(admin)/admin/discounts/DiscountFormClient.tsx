'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { adminConfirm } from '@/components/admin/AdminModal/adminConfirm';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminPillChip, AdminPillChipList } from '@/components/AdminPillChip/AdminPillChip';
import {
  AdminSortableTable,
  DragHandleCell,
} from '@/components/admin/AdminSortableTable/AdminSortableTable';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import { AdminTextArea, AdminTextField } from '@/components/AdminTextField/AdminTextField';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type {
  AdminDiscountDetail,
  AdminDiscountRule,
  DiscountScope,
} from '@/lib/adminDiscountTypes';
import {
  DISCOUNT_STATUS_LABELS,
  deriveDiscountStatus,
  discountStatusBadgeClass,
} from '@/lib/adminDiscountTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import dateStyles from '@/components/admin/AdminDateField/AdminDateField.module.css';
import {
  DiscountCategoryPickerModal,
  DiscountProductPickerModal,
} from './DiscountScopePickerModal';
import {
  DiscountRuleModal,
  cloneRule,
  conditionsFromApi,
  emptyRule,
  formatRuleConditions,
  formatRuleReward,
  normalizeConditionsDraft,
  type RuleDraft,
} from './DiscountRuleModal';
import {
  DISCOUNT_CATEGORY_NO_DESCENDANTS_HINT,
  DISCOUNT_OVERLAP_MAX_BENEFIT_HINT,
} from './discountHints';

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

function combineMoscowDateTime(ymd: string, hm: string): string {
  const [hRaw, mRaw] = hm.split(':');
  const h = String(Number(hRaw) || 0).padStart(2, '0');
  const m = String(Number(mRaw) || 0).padStart(2, '0');
  return `${ymd}T${h}:${m}:00.000+03:00`;
}

export function DiscountFormClient({ discountId }: { discountId?: string }) {
  const router = useRouter();
  const isEdit = Boolean(discountId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<DiscountScope>('CATEGORY');
  const [active, setActive] = useState(true);

  const [startsDate, setStartsDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }),
  );
  const [startsTime, setStartsTime] = useState('00:00');
  const [hasEndsAt, setHasEndsAt] = useState(false);
  const [endsDate, setEndsDate] = useState('');
  const [endsTime, setEndsTime] = useState('23:59');

  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [productIds, setProductIds] = useState<string[]>([]);
  const [productLabels, setProductLabels] = useState<Record<string, string>>({});
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [prodModalOpen, setProdModalOpen] = useState(false);

  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleModalMode, setRuleModalMode] = useState<'create' | 'edit'>('create');
  const [ruleModalInitial, setRuleModalInitial] = useState<RuleDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (!discountId) {
          setLoading(false);
          return;
        }
        const row = await adminBackendJson<AdminDiscountDetail>(
          `discounts/admin/${discountId}`,
        );
        if (cancelled) return;
        setName(row.name);
        setDescription(row.description ?? '');
        setScope(row.scope);
        setActive(row.active);

        const start = parseMoscowParts(row.startsAt);
        setStartsDate(start.date);
        setStartsTime(start.time);
        if (row.endsAt) {
          const end = parseMoscowParts(row.endsAt);
          setHasEndsAt(true);
          setEndsDate(end.date);
          setEndsTime(end.time);
        } else {
          setHasEndsAt(false);
          setEndsDate('');
          setEndsTime('23:59');
        }

        setCategoryIds(row.categoryIds);
        setCategoryLabels(
          Object.fromEntries(
            row.categories.map((c) => [
              c.id,
              c.parentName ? `${c.parentName} → ${c.name}` : c.name,
            ]),
          ),
        );
        setProductIds(row.productIds);
        setProductLabels(Object.fromEntries(row.products.map((p) => [p.id, p.name])));

        setRules(
          row.rules.map((r, i) => {
            const cond = conditionsFromApi(r.conditions);
            return {
              key: r.id ?? `r-${i}`,
              id: r.id,
              name: r.name,
              logic: cond.logic,
              conditionItems: cond.conditionItems,
              useConditions: cond.useConditions,
              description: r.description ?? '',
              rewardType: r.rewardType,
              rewardValue: String(r.rewardValue),
            };
          }),
        );
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
  }, [discountId]);

  function openCreateRule() {
    setRuleModalMode('create');
    setRuleModalInitial(emptyRule());
    setRuleModalOpen(true);
  }

  function openEditRule(rule: RuleDraft) {
    setRuleModalMode('edit');
    setRuleModalInitial(cloneRule(rule));
    setRuleModalOpen(true);
  }

  function saveRuleFromModal(rule: RuleDraft) {
    if (ruleModalMode === 'create') {
      setRules((prev) => [...prev, rule]);
    } else {
      setRules((prev) => prev.map((r) => (r.key === rule.key ? rule : r)));
    }
    setRuleModalOpen(false);
    setRuleModalInitial(null);
  }

  async function removeRule(rule: RuleDraft) {
    const label = rule.name.trim() || 'без названия';
    const ok = await adminConfirm({
      title: 'Удалить правило',
      message: `Удалить правило «${label}»?`,
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setRules((prev) => prev.filter((r) => r.key !== rule.key));
  }

  async function changeScope(next: DiscountScope) {
    if (next === scope) return;
    const clearingProducts = next === 'CATEGORY' && productIds.length > 0;
    const clearingCategories = next === 'PRODUCTS' && categoryIds.length > 0;
    if (clearingProducts || clearingCategories) {
      const ok = await adminConfirm({
        title: 'Сменить область',
        message:
          next === 'CATEGORY'
            ? 'Сменить область на категории? Выбор товаров будет очищен.'
            : 'Сменить область на товары? Выбор категорий будет очищен.',
        confirmLabel: 'Сменить',
      });
      if (!ok) return;
    }
    if (next === 'CATEGORY') {
      setProductIds([]);
      setProductLabels({});
    } else {
      setCategoryIds([]);
      setCategoryLabels({});
    }
    setScope(next);
  }

  function reorderRules(orderedKeys: string[]) {
    setRules((prev) => {
      const byKey = new Map(prev.map((r) => [r.key, r]));
      return orderedKeys.map((key) => byKey.get(key)!).filter(Boolean);
    });
  }

  function removeSelectedCategory(id: string) {
    setCategoryIds((prev) => prev.filter((x) => x !== id));
  }

  function removeSelectedProduct(id: string) {
    setProductIds((prev) => prev.filter((x) => x !== id));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (!name.trim()) throw new Error('Укажите название');
      if (!startsDate) throw new Error('Укажите дату начала');
      if (hasEndsAt && !endsDate) throw new Error('Укажите дату окончания или снимите галочку');

      const normalizedRules: AdminDiscountRule[] = rules.map((r) => {
        if (!r.name.trim()) throw new Error('У каждого правила должно быть название');
        const rewardValue = Number(r.rewardValue);
        if (!Number.isInteger(rewardValue) || rewardValue < 1) {
          throw new Error(
            `Правило «${r.name}»: Значение вознаграждения: целое число ≥ 1`,
          );
        }
        if (r.rewardType === 'PERCENT' && rewardValue > 100) {
          throw new Error(`Правило «${r.name}»: Процент скидки: от 1 до 100`);
        }
        return {
          id: r.id,
          name: r.name.trim(),
          conditions: normalizeConditionsDraft(
            r.logic,
            r.conditionItems,
            r.name.trim(),
            r.useConditions,
          ),
          description: r.description.trim() || null,
          rewardType: r.rewardType,
          rewardValue,
        };
      });

      const body = {
        name: name.trim(),
        description: description.trim() || null,
        scope,
        active,
        startsAt: combineMoscowDateTime(startsDate, startsTime || '00:00'),
        endsAt: hasEndsAt ? combineMoscowDateTime(endsDate, endsTime || '23:59') : null,
        categoryIds: scope === 'CATEGORY' ? categoryIds : [],
        productIds: scope === 'PRODUCTS' ? productIds : [],
        rules: normalizedRules,
      };

      if (!isEdit) {
        const created = await adminBackendJson<AdminDiscountDetail>('discounts/admin', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        router.replace(`/admin/discounts/${created.id}`);
        router.refresh();
        return;
      }

      await adminBackendJson(`discounts/admin/${discountId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
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

  if (loading) return <p className={styles.muted}>Загрузка…</p>;

  const derivedStatus = deriveDiscountStatus({
    active,
    startsAt: startsDate
      ? combineMoscowDateTime(startsDate, startsTime || '00:00')
      : new Date().toISOString(),
    endsAt:
      hasEndsAt && endsDate
        ? combineMoscowDateTime(endsDate, endsTime || '23:59')
        : null,
    ruleCount: rules.length,
  });

  return (
    <>
      <form onSubmit={(e) => void onSave(e)} className={`${styles.form} ${styles.formWide}`}>
        <p className={styles.backRow}>
          <AdminCompactBtnLink href="/admin/discounts" variant="outline">
            ← К списку
          </AdminCompactBtnLink>
        </p>
        <div className={styles.detailTitleRow}>
          <h1 className={styles.title}>
            {isEdit ? 'Скидка' : 'Новая скидка'}{' '}
            <span
              className={`${styles.badge} ${discountStatusBadgeClass(derivedStatus, styles)}`}
            >
              {DISCOUNT_STATUS_LABELS[derivedStatus]}
            </span>
          </h1>
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
          label="Название"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Настройка области</h2>
          <AdminTabs
            ariaLabel="Область скидки"
            variant="underline"
            compact
            activeId={scope}
            onChange={(id) => void changeScope(id as DiscountScope)}
            items={[
              { id: 'CATEGORY', label: 'Категория / подкатегория' },
              { id: 'PRODUCTS', label: 'Конкретные товары' },
            ]}
          />
          {scope === 'CATEGORY' ? (
            <p className={styles.muted}>{DISCOUNT_CATEGORY_NO_DESCENDANTS_HINT}</p>
          ) : null}

          {scope === 'CATEGORY' ? (
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
                        onRemove={() => removeSelectedCategory(id)}
                        removeAriaLabel={`Убрать «${label}»`}
                      >
                        {label}
                      </AdminPillChip>
                    );
                  })}
                </AdminPillChipList>
              )}
            </div>
          ) : (
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
                        onRemove={() => removeSelectedProduct(id)}
                        removeAriaLabel={`Убрать «${label}»`}
                      >
                        {label}
                      </AdminPillChip>
                    );
                  })}
                </AdminPillChipList>
              )}
            </div>
          )}
        </section>

        <AdminTextArea
          label="Описание"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Время активности</h2>
          <div className={dateStyles.customRange}>
            <label className={dateStyles.dateField}>
              <span className={dateStyles.dateLabel}>Дата начала</span>
              <input
                className={dateStyles.dateInput}
                type="date"
                value={startsDate}
                required
                onChange={(e) => setStartsDate(e.target.value)}
              />
            </label>
            <label className={`${dateStyles.dateField} ${dateStyles.dateFieldTime}`}>
              <span className={dateStyles.dateLabel}>Время</span>
              <input
                className={dateStyles.dateInput}
                type="time"
                value={startsTime}
                required
                onChange={(e) => setStartsTime(e.target.value)}
              />
            </label>
            <div className={styles.labelCheckboxRow}>
              <AdminCheckbox
                id="discount-has-ends"
                className={styles.adminCheckboxForm}
                checked={hasEndsAt}
                onChange={(e) => {
                  const on = e.target.checked;
                  setHasEndsAt(on);
                  if (on && !endsDate) {
                    setEndsDate(startsDate);
                    setEndsTime('23:59');
                  }
                }}
              />
              <label htmlFor="discount-has-ends">Дата окончания</label>
            </div>
            {hasEndsAt ? (
              <>
                <label className={dateStyles.dateField}>
                  <span className={dateStyles.dateLabel}>По</span>
                  <input
                    className={dateStyles.dateInput}
                    type="date"
                    value={endsDate}
                    min={startsDate}
                    required
                    onChange={(e) => setEndsDate(e.target.value)}
                  />
                </label>
                <label className={`${dateStyles.dateField} ${dateStyles.dateFieldTime}`}>
                  <span className={dateStyles.dateLabel}>Время</span>
                  <input
                    className={dateStyles.dateInput}
                    type="time"
                    value={endsTime}
                    required
                    onChange={(e) => setEndsTime(e.target.value)}
                  />
                </label>
              </>
            ) : null}
          </div>
        </section>

        <div className={styles.labelCheckboxRow}>
          <AdminCheckbox
            id="discount-active"
            className={styles.adminCheckboxForm}
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <label htmlFor="discount-active">Активна (флаг)</label>
        </div>
        <p className={styles.muted}>
          Derived-статус в шапке (Черновик / Запланирована / Идёт / …) считается по флагу,
          периоду и числу правил — не равен галочке «Активна».
        </p>

        <section className={styles.section}>
          <div className={styles.detailTitleRow} style={{ marginBottom: 12 }}>
            <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
              Правила
            </h2>
            <AdminCompactBtn type="button" variant="outline" onClick={openCreateRule}>
              + Правило
            </AdminCompactBtn>
          </div>
          <p className={styles.muted}>
            Условия правила — только по товарам из области скидки, не по всей корзине. Можно
            задать правило без порога. {DISCOUNT_OVERLAP_MAX_BENEFIT_HINT}
          </p>

          {rules.length === 0 ? (
            <p className={styles.muted}>
              Правил пока нет — без правил скидка на checkout не применится (статус «Черновик»).
            </p>
          ) : (
            <AdminSortableTable
              ids={rules.map((r) => r.key)}
              onReorder={reorderRules}
              head={
                <tr>
                  <th style={{ width: 36 }} aria-label="Порядок" />
                  <th>Название</th>
                  <th>Условия</th>
                  <th>Вознаграждение</th>
                  <th>Описание</th>
                  <th />
                </tr>
              }
              renderRow={(key, drag) => {
                const rule = rules.find((r) => r.key === key);
                if (!rule) return null;
                return (
                  <>
                    <DragHandleCell {...drag} />
                    <td>{rule.name || 'Без названия'}</td>
                    <td className={styles.mutedInline}>{formatRuleConditions(rule)}</td>
                    <td>{formatRuleReward(rule)}</td>
                    <td className={styles.mutedInline}>
                      {rule.description.trim() || '—'}
                    </td>
                    <td className={styles.tableCellActions}>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        onClick={() => openEditRule(rule)}
                      >
                        Изменить
                      </AdminCompactBtn>
                      <AdminCompactBtn
                        type="button"
                        variant="danger"
                        onClick={() => void removeRule(rule)}
                      >
                        Удалить
                      </AdminCompactBtn>
                    </td>
                  </>
                );
              }}
            />
          )}
        </section>
      </form>

      <DiscountCategoryPickerModal
        open={catModalOpen}
        selectedIds={categoryIds}
        onClose={() => setCatModalOpen(false)}
        onApply={(ids, labels) => {
          setCategoryIds(ids);
          setCategoryLabels(labels);
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
      <DiscountRuleModal
        open={ruleModalOpen}
        mode={ruleModalMode}
        initial={ruleModalInitial}
        onClose={() => {
          setRuleModalOpen(false);
          setRuleModalInitial(null);
        }}
        onSave={saveRuleFromModal}
      />
    </>
  );
}
