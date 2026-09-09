'use client';

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminSettingsListErrors } from '@/components/admin/AdminSettingsListErrors/AdminSettingsListErrors';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
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
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';
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

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SortableAttrRow({
  item,
  disabled,
  onChange,
  onRemove,
}: {
  item: Draft;
  disabled: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`${styles.faqCard} ${isDragging ? styles.faqCardDragging : ''}`}
    >
      <div className={styles.faqCardHead}>
        <button
          type="button"
          className={styles.dragBtn}
          {...attributes}
          {...listeners}
          aria-label="Перетащить"
          disabled={disabled}
        >
          ⋮⋮
        </button>
        <label className={styles.activeLabel}>
          <AdminCheckbox
            checked={item.active}
            onChange={(e) => onChange({ active: e.target.checked })}
            disabled={disabled}
          />
          Активен
        </label>
        <AdminCompactBtn
          type="button"
          variant="outline"
          className={catalogStyles.iconDangerBtn}
          onClick={onRemove}
          disabled={disabled || item.usageCount > 0}
          aria-label="Удалить"
          title={
            item.usageCount > 0
              ? `Используется на ${item.usageCount} товар(ах) — сначала снимите с товаров`
              : 'Удалить'
          }
        >
          <TrashIcon />
        </AdminCompactBtn>
      </div>
      <AdminTextField
        label="Значение"
        value={item.label}
        onChange={(e) => onChange({ label: e.target.value })}
        disabled={disabled}
        maxLength={500}
      />
      {item.usageCount > 0 ? (
        <p className={catalogStyles.muted}>
          На товарах: {item.usageCount}. Чтобы удалить — снимите значение с товаров. Переименование
          обновит эти товары.
        </p>
      ) : null}
    </li>
  );
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
  const tabIds = useMemo(() => tabItems.map((it) => it.key), [tabItems]);

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

  function patchItem(key: string, patch: Partial<Draft>) {
    markDirty();
    setItems((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeItem(key: string) {
    const target = items.find((row) => row.key === key);
    if (!target) return;
    if (target.usageCount > 0) {
      showToast(
        `«${target.label}» стоит на ${target.usageCount} товар(ах) — сначала снимите с товаров`,
      );
      return;
    }
    markDirty();
    setItems((prev) => prev.filter((row) => row.key !== key));
  }

  function addValue() {
    markDirty();
    setItems((prev) => [
      ...prev,
      { key: newKey(), kind: tab, label: '', active: true, usageCount: 0 },
    ]);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabIds.indexOf(String(active.id));
    const newIndex = tabIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    markDirty();
    setItems((prev) => {
      const kindItems = prev.filter((row) => row.kind === tab);
      const reordered = arrayMove(kindItems, oldIndex, newIndex);
      let qi = 0;
      return prev.map((row) => (row.kind === tab ? reordered[qi++]! : row));
    });
  }

  return (
    <form
      onSubmit={(e) => void onSave(e)}
      className={`${catalogStyles.form} ${catalogStyles.formWide}`}
    >
      <div className={pn.stickyToolbar}>
        <div className={pn.stickyToolbarMain}>
          <div className={pn.stickyToolbarNav}>
            <AdminCompactBtnLink href="/admin/settings" variant="outline">
              ← Настройки
            </AdminCompactBtnLink>
            {dirty ? <span className={pn.dirtyHintInline}>Несохранённые изменения</span> : null}
          </div>
          <h1 className={pn.stickyToolbarTitle}>Атрибуты</h1>
        </div>
        <div className={pn.stickyToolbarActions}>
          <AdminCompactBtn
            type="button"
            variant="outline"
            disabled={!canEdit || saving}
            onClick={addValue}
          >
            Добавить значение
          </AdminCompactBtn>
          <AdminCompactBtn type="submit" variant="accent" disabled={!canSave}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </AdminCompactBtn>
        </div>
      </div>

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
        <>
          <AdminTabs
            ariaLabel="Вид атрибута"
            activeId={tab}
            onChange={setTab}
            items={PRODUCT_ATTRIBUTE_KINDS.map((kind) => ({
              id: kind,
              label: PRODUCT_ATTRIBUTE_KIND_LABELS[kind],
            }))}
          />

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={tabIds} strategy={verticalListSortingStrategy}>
              <ul className={styles.faqList}>
                {tabItems.map((item) => (
                  <SortableAttrRow
                    key={item.key}
                    item={item}
                    disabled={saving}
                    onChange={(patch) => patchItem(item.key, patch)}
                    onRemove={() => removeItem(item.key)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          {tabItems.length === 0 ? (
            <p className={catalogStyles.lead}>Значений пока нет</p>
          ) : null}
        </>
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
    </form>
  );
}
