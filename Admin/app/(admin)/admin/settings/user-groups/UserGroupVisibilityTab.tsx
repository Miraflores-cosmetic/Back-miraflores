'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DiscountCategoryPickerModal,
  DiscountProductPickerModal,
} from '@/app/(admin)/admin/discounts/DiscountScopePickerModal';
import { VariantPickerModal } from '@/app/(admin)/admin/settings/gratitude/VariantPickerModal';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type { AdminCatalogVisibilityRule } from '@/lib/adminUserGroupTypes';
import {
  VISIBILITY_CONFLICT_HINT,
  VISIBILITY_MODE_HELP,
  VISIBILITY_MODE_LABELS,
  VISIBILITY_TARGET_LABELS,
  visibilityAudiencePreview,
  type VisibilityMode,
  type VisibilityTargetType,
} from '@/lib/userGroupVisibilityHelp';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import settingsStyles from '@/app/(admin)/admin/settings/Settings.module.css';

type Props = {
  groupId: string;
  groupName: string;
  onChanged?: () => void;
};

export function UserGroupVisibilityTab({ groupId, groupName, onChanged }: Props) {
  const { showToast } = useToast();
  const [rules, setRules] = useState<AdminCatalogVisibilityRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [visMode, setVisMode] = useState<VisibilityMode>('HIDE_FROM_GROUP');
  const [visTargetType, setVisTargetType] = useState<VisibilityTargetType>('PRODUCT');
  const [visTargetId, setVisTargetId] = useState<string | null>(null);
  const [visTargetLabel, setVisTargetLabel] = useState('');
  const [visProductPickerOpen, setVisProductPickerOpen] = useState(false);
  const [visCategoryPickerOpen, setVisCategoryPickerOpen] = useState(false);
  const [visVariantPickerOpen, setVisVariantPickerOpen] = useState(false);
  const [filterMode, setFilterMode] = useState<VisibilityMode | ''>('');
  const [deleteRule, setDeleteRule] = useState<AdminCatalogVisibilityRule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminBackendJson<{ items: AdminCatalogVisibilityRule[] }>(
        `user-groups/admin/${groupId}/visibility`,
      );
      setRules(res.items);
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const modeHelp = VISIBILITY_MODE_HELP[visMode];
  const filteredRules = useMemo(
    () => (filterMode ? rules.filter((r) => r.mode === filterMode) : rules),
    [rules, filterMode],
  );

  function openVisibilityTargetPicker() {
    if (visTargetType === 'PRODUCT') setVisProductPickerOpen(true);
    else if (visTargetType === 'CATEGORY') setVisCategoryPickerOpen(true);
    else setVisVariantPickerOpen(true);
  }

  async function submitRule(e: React.FormEvent) {
    e.preventDefault();
    if (!visTargetId) return;
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/visibility`, {
        method: 'POST',
        body: JSON.stringify({
          mode: visMode,
          targetType: visTargetType,
          targetId: visTargetId,
        }),
      });
      showToast('Правило добавлено');
      setVisTargetId(null);
      setVisTargetLabel('');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось добавить правило');
    } finally {
      setSaving(false);
    }
  }

  async function deleteVisibilityRule(ruleId: string) {
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/visibility/${ruleId}`, {
        method: 'DELETE',
      });
      showToast('Правило удалено');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось удалить');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error ? (
        <p className={catalogStyles.error} role="alert">
          {error}
        </p>
      ) : null}
      <section className={settingsStyles.faqCard}>
        <p className={catalogStyles.muted} style={{ margin: 0 }}>
          {VISIBILITY_CONFLICT_HINT}
        </p>
        <form className={settingsStyles.menuFormStack} onSubmit={(e) => void submitRule(e)}>
          <label className={catalogStyles.label}>
            Режим
            <select
              className={catalogStyles.select}
              value={visMode}
              onChange={(e) => setVisMode(e.target.value as VisibilityMode)}
            >
              {Object.entries(VISIBILITY_MODE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className={catalogStyles.warningBanner} style={{ margin: 0 }} role="note">
            <div>
              <strong>{modeHelp.kind === 'hide' ? 'Скрытие' : 'Белый список'}:</strong>{' '}
              {modeHelp.summary}
              <br />
              <span className={catalogStyles.mutedInline}>{modeHelp.example}</span>
              <br />
              <span className={catalogStyles.mutedInline}>
                Кто видит: {visibilityAudiencePreview(visMode, groupName)}
              </span>
            </div>
          </div>
          <label className={catalogStyles.label}>
            Тип цели
            <select
              className={catalogStyles.select}
              value={visTargetType}
              onChange={(e) => {
                setVisTargetType(e.target.value as VisibilityTargetType);
                setVisTargetId(null);
                setVisTargetLabel('');
              }}
            >
              {Object.entries(VISIBILITY_TARGET_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <AdminCompactBtn type="button" variant="outline" onClick={openVisibilityTargetPicker}>
            {visTargetLabel || 'Выбрать цель'}
          </AdminCompactBtn>
          <div>
            <AdminCompactBtn type="submit" variant="accent" disabled={saving || !visTargetId}>
              Добавить правило
            </AdminCompactBtn>
          </div>
        </form>
      </section>

      <div className={catalogStyles.toolbar} style={{ marginBottom: 12 }}>
        <label className={catalogStyles.label} style={{ margin: 0 }}>
          Фильтр режима
          <select
            className={catalogStyles.select}
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as VisibilityMode | '')}
          >
            <option value="">Все ({rules.length})</option>
            {Object.entries(VISIBILITY_MODE_LABELS).map(([k, label]) => {
              const count = rules.filter((r) => r.mode === k).length;
              if (!count) return null;
              return (
                <option key={k} value={k}>
                  {label} ({count})
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {loading ? <p className={catalogStyles.muted}>Загрузка…</p> : null}
      <div className={catalogStyles.tableWrap}>
        <table className={catalogStyles.table}>
          <thead>
            <tr>
              <th>Режим</th>
              <th>Цель</th>
              <th>Объект</th>
              <th>Кто видит</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && filteredRules.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  {rules.length ? (
                    <p className={catalogStyles.mutedInline}>Нет правил с выбранным режимом</p>
                  ) : (
                    <div className={settingsStyles.settingsEmpty}>
                      <p className={settingsStyles.settingsEmptyTitle}>Правил видимости пока нет</p>
                      <p className={settingsStyles.settingsEmptyHint}>
                        Скрывайте или показывайте товары, категории и варианты только нужной
                        аудитории.
                      </p>
                      <AdminCompactBtn
                        type="button"
                        variant="accent"
                        disabled={saving}
                        onClick={openVisibilityTargetPicker}
                      >
                        Добавить первое правило
                      </AdminCompactBtn>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              filteredRules.map((r) => (
                <tr key={r.id}>
                  <td>{VISIBILITY_MODE_LABELS[r.mode as VisibilityMode] ?? r.mode}</td>
                  <td>
                    {VISIBILITY_TARGET_LABELS[r.targetType as VisibilityTargetType] ?? r.targetType}
                  </td>
                  <td>{r.targetLabel ?? r.targetId}</td>
                  <td className={catalogStyles.mutedInline}>
                    {visibilityAudiencePreview(r.mode, groupName)}
                  </td>
                  <td>
                    <AdminCompactBtn
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => setDeleteRule(r)}
                    >
                      Удалить
                    </AdminCompactBtn>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DiscountProductPickerModal
        open={visProductPickerOpen}
        single
        selectedIds={visTargetId ? [visTargetId] : []}
        selectedLabels={visTargetId && visTargetLabel ? { [visTargetId]: visTargetLabel } : {}}
        onClose={() => setVisProductPickerOpen(false)}
        onApply={(ids, labels) => {
          const id = ids[0];
          if (!id) return;
          setVisTargetId(id);
          setVisTargetLabel(labels[id] ?? id);
        }}
      />
      <DiscountCategoryPickerModal
        open={visCategoryPickerOpen}
        single
        selectedIds={visTargetId ? [visTargetId] : []}
        onClose={() => setVisCategoryPickerOpen(false)}
        onApply={(ids, labels) => {
          const id = ids[0];
          if (!id) return;
          setVisTargetId(id);
          setVisTargetLabel(labels[id] ?? id);
        }}
      />
      <VariantPickerModal
        open={visVariantPickerOpen}
        selectedVariantId={visTargetId ?? ''}
        selectedLabel={visTargetLabel}
        onClose={() => setVisVariantPickerOpen(false)}
        onApply={(id, label) => {
          setVisTargetId(id);
          setVisTargetLabel(label);
        }}
      />
      <ConfirmDialog
        open={deleteRule != null}
        title="Удалить правило видимости?"
        message={
          deleteRule
            ? `Убрать «${VISIBILITY_MODE_LABELS[deleteRule.mode as VisibilityMode] ?? deleteRule.mode}» для ${deleteRule.targetLabel ?? deleteRule.targetId}?`
            : ''
        }
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        danger
        onCancel={() => setDeleteRule(null)}
        onConfirm={() => {
          if (!deleteRule) return;
          const id = deleteRule.id;
          setDeleteRule(null);
          void deleteVisibilityRule(id);
        }}
      />
    </>
  );
}
