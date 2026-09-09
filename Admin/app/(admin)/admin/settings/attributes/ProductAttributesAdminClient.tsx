'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminSettingsListErrors } from '@/components/admin/AdminSettingsListErrors/AdminSettingsListErrors';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import {
  PRODUCT_ATTRIBUTE_KINDS,
  PRODUCT_ATTRIBUTE_KIND_LABELS,
  type ProductAttributeKind,
  type ProductAttributeOptionApi,
} from '@/lib/productAttributes';
import { useAdminSettingsListShell } from '@/lib/useAdminSettingsListShell';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import styles from '@/app/(admin)/admin/settings/Settings.module.css';

type Draft = {
  key: string;
  id?: string;
  kind: ProductAttributeKind;
  label: string;
  active: boolean;
  usageCount: number;
};

function newKey() {
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

function mapApiItems(items: ProductAttributeOptionApi[]): Draft[] {
  return (items ?? []).map((it) => ({
    key: it.id,
    id: it.id,
    kind: it.kind,
    label: it.label,
    active: it.active,
    usageCount: it.usageCount ?? 0,
  }));
}

export function ProductAttributesAdminClient() {
  const { showToast } = useToast();
  const {
    loading,
    loadedOk,
    saving,
    dirty,
    loadError,
    actionError,
    markDirty,
    beginLoad,
    succeedLoad,
    failLoad,
    beginSave,
    succeedSave,
    failSave,
    setActionError,
    setLoadError,
  } = useAdminSettingsListShell();
  const [items, setItems] = useState<Draft[]>([]);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<ProductAttributeKind>('productType');
  const [confirmEmptyWipe, setConfirmEmptyWipe] = useState(false);
  const loadedCountRef = useRef(0);

  const load = useCallback(async () => {
    beginLoad();
    try {
      const data = await adminBackendJson<{
        items: ProductAttributeOptionApi[];
        revision?: number;
      }>('settings/admin/product-attributes');
      const mapped = mapApiItems(data.items ?? []);
      loadedCountRef.current = mapped.length;
      setRevision(data.revision ?? 0);
      setItems(mapped);
      succeedLoad();
    } catch (e) {
      setItems([]);
      loadedCountRef.current = 0;
      setRevision(0);
      failLoad(e);
    }
  }, [beginLoad, succeedLoad, failLoad]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabItems = useMemo(() => items.filter((it) => it.kind === tab), [items, tab]);

  async function persist(allowEmpty = false) {
    beginSave();
    try {
      const data = await adminBackendJson<{
        items: ProductAttributeOptionApi[];
        revision?: number;
      }>('settings/admin/product-attributes', {
        method: 'PUT',
        body: JSON.stringify({
          allowEmpty: allowEmpty || undefined,
          expectedRevision: revision,
          items: items.map((it) => ({
            ...(it.id ? { id: it.id } : {}),
            kind: it.kind,
            label: it.label.trim(),
            active: it.active,
          })),
        }),
      });
      const mapped = mapApiItems(data.items ?? []);
      loadedCountRef.current = mapped.length;
      setRevision(data.revision ?? revision + 1);
      setItems(mapped);
      succeedSave();
      showToast('Атрибуты сохранены');
    } catch (err) {
      if (err instanceof AdminBackendRequestError && err.status === 409) {
        showToast(err.message || 'Каталог уже изменён — обновляю список');
        await load();
        failSave(err);
        return;
      }
      showToast(failSave(err));
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!loadedOk) return;

    const incomplete = items.filter((it) => !it.label.trim());
    if (incomplete.length > 0) {
      showToast(
        incomplete.length === 1
          ? 'Заполните значение или удалите пустой пункт'
          : `Есть пустые пункты (${incomplete.length}) — заполните или удалите`,
      );
      return;
    }

    const seen = new Set<string>();
    for (const it of items) {
      const key = `${it.kind}:${it.label.trim().toLowerCase()}`;
      if (seen.has(key)) {
        showToast(
          `Дубликат «${it.label.trim()}» в «${PRODUCT_ATTRIBUTE_KIND_LABELS[it.kind]}» — оставьте одно`,
        );
        return;
      }
      seen.add(key);
    }

    if (items.length === 0 && loadedCountRef.current > 0) {
      setConfirmEmptyWipe(true);
      return;
    }

    await persist(false);
  }

  const canEdit = loadedOk && !loading;
  const canSave = canEdit && dirty && !saving;

  function patchTabItem(indexInTab: number, patch: Partial<Draft>) {
    const target = tabItems[indexInTab];
    if (!target) return;
    markDirty();
    setItems((prev) =>
      prev.map((row) => (row.key === target.key ? { ...row, ...patch } : row)),
    );
  }

  function removeTabItem(indexInTab: number) {
    const target = tabItems[indexInTab];
    if (!target) return;
    if (target.usageCount > 0) {
      showToast(
        `«${target.label}» стоит на ${target.usageCount} товар(ах) — переименуйте или снимите с товаров, затем удалите`,
      );
      return;
    }
    markDirty();
    setItems((prev) => prev.filter((row) => row.key !== target.key));
  }

  function moveTabItem(indexInTab: number, dir: -1 | 1) {
    const next = indexInTab + dir;
    if (next < 0 || next >= tabItems.length) return;
    const a = tabItems[indexInTab]!;
    const b = tabItems[next]!;
    markDirty();
    setItems((prev) => {
      const ia = prev.findIndex((r) => r.key === a.key);
      const ib = prev.findIndex((r) => r.key === b.key);
      if (ia < 0 || ib < 0) return prev;
      const copy = [...prev];
      const tmp = copy[ia]!;
      copy[ia] = copy[ib]!;
      copy[ib] = tmp;
      return copy;
    });
  }

  return (
    <div>
      <div className={styles.hubHeader}>
        <h1 className={`${catalogStyles.title} ${styles.hubHeaderTitle}`}>Атрибуты</h1>
      </div>
      <p className={catalogStyles.lead}>
        Значения выпадающих списков в карточке товара: тип продукта, для чего, срок годности,
        хранение (plain-текст, не rich HTML). Переименование обновляет товары; удаление опции на
        товарах запрещено. Дубликаты в одном списке не допускаются.
      </p>

      <AdminSettingsListErrors
        loadError={loadError}
        actionError={actionError}
        onRetry={() => void load()}
        onDismissLoad={() => setLoadError(null)}
        onDismissAction={() => setActionError(null)}
      />

      {loading ? (
        <p className={catalogStyles.lead}>Загрузка…</p>
      ) : !loadedOk ? (
        <p className={catalogStyles.lead}>
          Не удалось загрузить атрибуты. Нажмите «Повторить» — сохранение отключено.
        </p>
      ) : (
        <form
          onSubmit={(e) => void onSave(e)}
          className={`${catalogStyles.form} ${catalogStyles.formWide}`}
        >
          {dirty ? <p className={catalogStyles.lead}>Несохранённые изменения</p> : null}

          <div className={styles.tabs} role="tablist" aria-label="Вид атрибута">
            {PRODUCT_ATTRIBUTE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={tab === kind}
                className={`${styles.tab} ${tab === kind ? styles.tabActive : ''}`}
                onClick={() => setTab(kind)}
              >
                {PRODUCT_ATTRIBUTE_KIND_LABELS[kind]}
              </button>
            ))}
          </div>

          <ul className={styles.faqList}>
            {tabItems.map((item, index) => (
              <li key={item.key} className={styles.faqCard}>
                <div className={styles.faqCardHead}>
                  <label className={styles.activeLabel}>
                    <AdminCheckbox
                      checked={item.active}
                      onChange={(e) => patchTabItem(index, { active: e.target.checked })}
                      disabled={saving}
                    />
                    Активен
                  </label>
                  <AdminCompactBtn
                    type="button"
                    variant="outline"
                    disabled={saving || index === 0}
                    onClick={() => moveTabItem(index, -1)}
                    aria-label="Выше"
                  >
                    ↑
                  </AdminCompactBtn>
                  <AdminCompactBtn
                    type="button"
                    variant="outline"
                    disabled={saving || index >= tabItems.length - 1}
                    onClick={() => moveTabItem(index, 1)}
                    aria-label="Ниже"
                  >
                    ↓
                  </AdminCompactBtn>
                  <AdminCompactBtn
                    type="button"
                    variant="danger"
                    onClick={() => removeTabItem(index)}
                    disabled={saving || item.usageCount > 0}
                    aria-label="Удалить"
                    title={
                      item.usageCount > 0
                        ? `Используется на ${item.usageCount} товар(ах)`
                        : 'Удалить'
                    }
                  >
                    Удалить
                  </AdminCompactBtn>
                </div>
                <AdminTextField
                  label="Значение"
                  value={item.label}
                  onChange={(e) => patchTabItem(index, { label: e.target.value })}
                  disabled={saving}
                  maxLength={500}
                />
                {item.usageCount > 0 ? (
                  <p className={catalogStyles.muted}>
                    На товарах: {item.usageCount}. Переименование обновит эти товары; удаление
                    заблокировано.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          {tabItems.length === 0 ? (
            <p className={catalogStyles.lead}>Значений пока нет</p>
          ) : null}

          <div className={catalogStyles.formActions}>
            <AdminCompactBtn
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                markDirty();
                setItems((prev) => [
                  ...prev,
                  { key: newKey(), kind: tab, label: '', active: true, usageCount: 0 },
                ]);
              }}
            >
              Добавить значение
            </AdminCompactBtn>
            <AdminCompactBtn type="submit" disabled={!canSave}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </AdminCompactBtn>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirmEmptyWipe}
        title="Очистить все опции?"
        message={`Сейчас будет удалён весь словарь атрибутов (${loadedCountRef.current} шт.). Опции на товарах удалить нельзя — сервер отклонит запрос. Продолжить?`}
        confirmLabel="Очистить"
        danger
        onCancel={() => setConfirmEmptyWipe(false)}
        onConfirm={() => {
          setConfirmEmptyWipe(false);
          void persist(true);
        }}
      />
    </div>
  );
}
