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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminSettingsListErrors } from '@/components/admin/AdminSettingsListErrors/AdminSettingsListErrors';
import { AdminTabs, AdminTabsLead } from '@/components/AdminTabs/AdminTabs';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
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

const TAB_SHORT: Record<ProductAttributeKind, string> = {
  productType: 'Тип',
  purpose: 'Для чего',
  shelfLife: 'Срок',
  storage: 'Хранение',
};

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

function parseAttrTab(raw: string | null): ProductAttributeKind {
  if (raw && (PRODUCT_ATTRIBUTE_KINDS as readonly string[]).includes(raw)) {
    return raw as ProductAttributeKind;
  }
  return 'productType';
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
  dragDisabled,
  onChange,
  onRemove,
}: {
  item: Draft;
  disabled: boolean;
  dragDisabled: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled: disabled || dragDisabled,
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
          disabled={disabled || dragDisabled}
          title={
            dragDisabled
              ? 'Сбросьте поиск и фильтр «только неактивные», чтобы менять порядок'
              : 'Перетащить'
          }
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
              : item.id
                ? 'Удалить (после Сохранить)'
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
    </li>
  );
}

export function ProductAttributesAdminClient() {
  const { showToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  const [tab, setTab] = useState<ProductAttributeKind>(() =>
    parseAttrTab(searchParams.get('tab')),
  );
  const [query, setQuery] = useState('');
  const [onlyInactive, setOnlyInactive] = useState(false);
  const [confirmEmptyWipe, setConfirmEmptyWipe] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Draft | null>(null);
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

  useEffect(() => {
    const fromUrl = parseAttrTab(searchParams.get('tab'));
    setTab((prev) => (prev === fromUrl ? prev : fromUrl));
  }, [searchParams]);

  function setTabInUrl(next: ProductAttributeKind) {
    setTab(next);
    const sp = new URLSearchParams(searchParams.toString());
    if (next === 'productType') sp.delete('tab');
    else sp.set('tab', next);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const counts = useMemo(() => {
    const out: Record<ProductAttributeKind, number> = {
      productType: 0,
      purpose: 0,
      shelfLife: 0,
      storage: 0,
    };
    for (const it of items) out[it.kind] += 1;
    return out;
  }, [items]);

  const kindRows = useMemo(() => items.filter((it) => it.kind === tab), [items, tab]);

  const visibleRows = useMemo(() => {
    let rows = kindRows;
    if (onlyInactive) rows = rows.filter((it) => !it.active);
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((it) => it.label.toLowerCase().includes(q));
    return rows;
  }, [kindRows, onlyInactive, query]);

  const visibleIds = useMemo(() => visibleRows.map((it) => it.key), [visibleRows]);
  const dragEnabled = !onlyInactive && !query.trim();

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

  function requestRemove(key: string) {
    const target = items.find((row) => row.key === key);
    if (!target) return;
    if (target.usageCount > 0) {
      showToast(
        `«${target.label}» стоит на ${target.usageCount} товар(ах) — сначала снимите с товаров`,
      );
      return;
    }
    if (target.id) {
      setPendingRemove(target);
      return;
    }
    markDirty();
    setItems((prev) => prev.filter((row) => row.key !== key));
  }

  function confirmRemove() {
    if (!pendingRemove) return;
    const key = pendingRemove.key;
    setPendingRemove(null);
    markDirty();
    setItems((prev) => prev.filter((row) => row.key !== key));
  }

  function addValue() {
    markDirty();
    setOnlyInactive(false);
    setQuery('');
    setItems((prev) => [
      ...prev,
      { key: newKey(), kind: tab, label: '', active: true, usageCount: 0 },
    ]);
  }

  function onDragEnd(event: DragEndEvent) {
    if (!dragEnabled) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const kindItems = items.filter((row) => row.kind === tab);
    const oldIndex = kindItems.findIndex((row) => row.key === String(active.id));
    const newIndex = kindItems.findIndex((row) => row.key === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    markDirty();
    setItems((prev) => {
      const current = prev.filter((row) => row.kind === tab);
      const reordered = arrayMove(current, oldIndex, newIndex);
      let qi = 0;
      return prev.map((row) => (row.kind === tab ? reordered[qi++]! : row));
    });
  }

  const emptyKind = kindRows.length === 0;
  const emptyFiltered = !emptyKind && visibleRows.length === 0;

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

      <AdminTabsLead>
        Порядок в списке = порядок в select товара. Переименование каскадом обновляет label на
        товарах. Удалить можно только неиспользуемые (0 товаров). «Сохранить» пушит все четыре
        вкладки одним запросом.
      </AdminTabsLead>

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
            variant="underline"
            compact
            activeId={tab}
            onChange={setTabInUrl}
            items={PRODUCT_ATTRIBUTE_KINDS.map((kind) => ({
              id: kind,
              label: `${TAB_SHORT[kind]} (${counts[kind]})`,
              'aria-label': `${PRODUCT_ATTRIBUTE_KIND_LABELS[kind]} (${counts[kind]})`,
            }))}
          />

          <div className={styles.attrListToolbar}>
            <div className={styles.attrListSearch}>
              <AdminSearchBox
                placeholder="Поиск по значению"
                ariaLabel="Поиск значений атрибута"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <label className={styles.attrFilterLabel}>
              <AdminCheckbox
                checked={onlyInactive}
                onChange={(e) => setOnlyInactive(e.target.checked)}
                disabled={saving}
              />
              Только неактивные
            </label>
          </div>

          {emptyKind ? (
            <div className={styles.settingsEmpty}>
              <p className={styles.settingsEmptyTitle}>
                Значений «{PRODUCT_ATTRIBUTE_KIND_LABELS[tab]}» пока нет
              </p>
              <p className={styles.settingsEmptyHint}>
                Добавьте пункты для выпадающего списка в карточке товара. Порядок можно менять
                перетаскиванием.
              </p>
              <AdminCompactBtn type="button" variant="accent" disabled={saving} onClick={addValue}>
                Добавить первое значение
              </AdminCompactBtn>
            </div>
          ) : emptyFiltered ? (
            <div className={styles.settingsEmpty}>
              <p className={styles.settingsEmptyTitle}>Ничего не найдено</p>
              <p className={styles.settingsEmptyHint}>
                Сбросьте поиск или фильтр «только неактивные».
              </p>
              <AdminCompactBtn
                type="button"
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setOnlyInactive(false);
                }}
              >
                Сбросить фильтры
              </AdminCompactBtn>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
                <ul className={styles.faqList}>
                  {visibleRows.map((item) => (
                    <SortableAttrRow
                      key={item.key}
                      item={item}
                      disabled={saving}
                      dragDisabled={!dragEnabled}
                      onChange={(patch) => patchItem(item.key, patch)}
                      onRemove={() => requestRemove(item.key)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
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

      <ConfirmDialog
        open={pendingRemove != null}
        title="Удалить значение?"
        message={
          pendingRemove
            ? `«${pendingRemove.label || 'без названия'}» исчезнет из словаря после «Сохранить». Продолжить?`
            : ''
        }
        confirmLabel="Удалить из черновика"
        danger
        onCancel={() => setPendingRemove(null)}
        onConfirm={confirmRemove}
      />
    </form>
  );
}
