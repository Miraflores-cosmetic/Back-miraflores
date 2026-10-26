'use client';

import {
  DndContext,
  DragEndEvent,
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminTextArea, AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendFetch,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { VariantPickerModal } from './VariantPickerModal';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import styles from '@/app/(admin)/admin/settings/Settings.module.css';
import giftStyles from './gratitudeAdmin.module.css';

type GiftDraft = {
  variantId: string;
  label: string;
  thumbnailUrl: string | null;
};

type RuleDraft = {
  key: string;
  id?: string;
  minRub: string;
  maxRub: string;
  gifts: GiftDraft[];
  active: boolean;
};

type TierDraft = {
  key: string;
  id?: string;
  title: string;
  infoHtml: string;
  imageUrl: string;
  active: boolean;
};

type GratitudeApi = {
  articleSlug: string | null;
  rules: Array<{
    id: string;
    minRub: number;
    maxRub: number | null;
    active: boolean;
    variantIds?: string[];
    gifts?: Array<{
      variantId: string;
      variantName: string;
      sku: string;
      productName: string;
      thumbnailUrl: string | null;
    }>;
  }>;
  tiers: Array<{
    id: string;
    title: string;
    infoHtml: string;
    imageUrl: string | null;
    active: boolean;
  }>;
};

function newKey() {
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

function giftLabel(productName: string, variantName: string, sku?: string) {
  const base = `${productName} — ${variantName}`;
  return sku ? `${base} (${sku})` : base;
}

function giftsFromApi(r: GratitudeApi['rules'][number]): GiftDraft[] {
  if (r.gifts?.length) {
    return r.gifts.map((g) => ({
      variantId: g.variantId,
      label: giftLabel(g.productName, g.variantName, g.sku),
      thumbnailUrl: g.thumbnailUrl,
    }));
  }
  return [];
}

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await adminBackendFetch('catalog/admin/upload-rich-media?type=image', {
    method: 'POST',
    body: fd,
  });
  const data = (await res.json()) as { url?: string };
  if (!res.ok || !data.url) throw new Error('upload failed');
  return data.url;
}

function SortableRuleRow({
  item,
  disabled,
  onChange,
  onRemove,
  onAddGift,
  onRemoveGift,
}: {
  item: RuleDraft;
  disabled: boolean;
  onChange: (patch: Partial<RuleDraft>) => void;
  onRemove: () => void;
  onAddGift: () => void;
  onRemoveGift: (variantId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
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
          Активно
        </label>
        <AdminCompactBtn type="button" variant="danger" onClick={onRemove} disabled={disabled}>
          Удалить
        </AdminCompactBtn>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <AdminTextField
          label="Мин. сумма, ₽"
          type="number"
          min={0}
          value={item.minRub}
          onChange={(e) => onChange({ minRub: e.target.value })}
          disabled={disabled}
        />
        <AdminTextField
          label="Макс. сумма, ₽ (опционально)"
          type="number"
          min={0}
          value={item.maxRub}
          onChange={(e) => onChange({ maxRub: e.target.value })}
          disabled={disabled}
        />
      </div>
      <div className={giftStyles.giftsBlock}>
        <p className={giftStyles.giftsLabel}>
          Подарки ({item.gifts.length})
        </p>
        {item.gifts.length === 0 ? (
          <p className={catalogStyles.muted} style={{ margin: '0 0 8px' }}>
            Не выбрано — добавьте хотя бы один вариант
          </p>
        ) : (
          <ul className={giftStyles.giftList}>
            {item.gifts.map((g) => (
              <li key={g.variantId} className={giftStyles.giftRow}>
                <div className={giftStyles.giftThumb} aria-hidden>
                  {g.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.thumbnailUrl} alt="" />
                  ) : (
                    <span className={giftStyles.giftThumbEmpty}>∅</span>
                  )}
                </div>
                <div className={giftStyles.giftMeta}>
                  <span className={giftStyles.giftTitle}>{g.label}</span>
                  <span className={giftStyles.giftId}>{g.variantId}</span>
                </div>
                <AdminCompactBtn
                  type="button"
                  variant="danger"
                  disabled={disabled}
                  onClick={() => onRemoveGift(g.variantId)}
                >
                  Убрать
                </AdminCompactBtn>
              </li>
            ))}
          </ul>
        )}
        <AdminCompactBtn type="button" variant="outline" onClick={onAddGift} disabled={disabled}>
          Добавить подарок
        </AdminCompactBtn>
      </div>
    </li>
  );
}

function SortableTierRow({
  item,
  disabled,
  onChange,
  onRemove,
  onUpload,
}: {
  item: TierDraft;
  disabled: boolean;
  onChange: (patch: Partial<TierDraft>) => void;
  onRemove: () => void;
  onUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
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
        <AdminCompactBtn type="button" variant="danger" onClick={onRemove} disabled={disabled}>
          Удалить
        </AdminCompactBtn>
      </div>
      <AdminTextField
        label="Заголовок"
        value={item.title}
        onChange={(e) => onChange({ title: e.target.value })}
        disabled={disabled}
        maxLength={200}
      />
      <AdminTextArea
        label="Описание (HTML)"
        value={item.infoHtml}
        onChange={(e) => onChange({ infoHtml: e.target.value })}
        disabled={disabled}
        rows={4}
      />
      <AdminTextField
        label="URL изображения"
        value={item.imageUrl}
        onChange={(e) => onChange({ imageUrl: e.target.value })}
        disabled={disabled}
      />
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" className={giftStyles.tierPreview} />
      ) : null}
      <AdminCompactBtn
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Загрузить изображение
      </AdminCompactBtn>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onUpload(file);
        }}
      />
    </li>
  );
}

export function GratitudeAdminClient() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadedOk, setLoadedOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [articleSlug, setArticleSlug] = useState('');
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [pickerKey, setPickerKey] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const markDirty = useCallback(() => setDirty(true), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadedOk(false);
    try {
      const data = await adminBackendJson<GratitudeApi>('settings/admin/gratitude');
      setArticleSlug(data.articleSlug ?? '');
      setRules(
        (data.rules ?? []).map((r) => ({
          key: r.id,
          id: r.id,
          minRub: String(r.minRub),
          maxRub: r.maxRub != null ? String(r.maxRub) : '',
          gifts: giftsFromApi(r),
          active: r.active,
        })),
      );
      setTiers(
        (data.tiers ?? []).map((t) => ({
          key: t.id,
          id: t.id,
          title: t.title,
          infoHtml: t.infoHtml,
          imageUrl: t.imageUrl ?? '',
          active: t.active,
        })),
      );
      setLoadedOk(true);
      setDirty(false);
    } catch (e) {
      setRules([]);
      setTiers([]);
      setLoadedOk(false);
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function onRulesDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRules((prev) => {
      const oldIndex = prev.findIndex((i) => i.key === active.id);
      const newIndex = prev.findIndex((i) => i.key === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      markDirty();
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function onTiersDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTiers((prev) => {
      const oldIndex = prev.findIndex((i) => i.key === active.id);
      const newIndex = prev.findIndex((i) => i.key === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      markDirty();
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!loadedOk) return;

    const parsedRules = rules.map((r) => ({
      id: r.id,
      minRub: Number(r.minRub),
      maxRub: r.maxRub.trim() ? Number(r.maxRub) : null,
      variantIds: r.gifts.map((g) => g.variantId),
      active: r.active,
    }));

    for (const r of parsedRules) {
      if (!Number.isFinite(r.minRub) || r.minRub < 0) {
        showToast('Укажите корректную минимальную сумму');
        return;
      }
      if (r.maxRub != null && (!Number.isFinite(r.maxRub) || r.maxRub < r.minRub)) {
        showToast('Максимальная сумма не может быть меньше минимальной');
        return;
      }
      if (r.variantIds.length === 0) {
        showToast('В каждом правиле нужен хотя бы один подарок');
        return;
      }
    }

    setSaving(true);
    try {
      await adminBackendJson('settings/admin/gratitude', {
        method: 'PUT',
        body: JSON.stringify({
          articleSlug: articleSlug.trim() || null,
          rules: parsedRules,
          tiers: tiers.map((t) => ({
            id: t.id,
            title: t.title,
            infoHtml: t.infoHtml,
            imageUrl: t.imageUrl.trim() || null,
            active: t.active,
          })),
        }),
      });
      await load();
      showToast('Сохранено');
    } catch (e) {
      showToast(e instanceof AdminBackendRequestError ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  const pickerRule = pickerKey ? rules.find((r) => r.key === pickerKey) : null;

  if (loading) return <p className={catalogStyles.muted}>Загрузка…</p>;
  if (error) {
    return (
      <p className={catalogStyles.error} role="alert">
        {error}
      </p>
    );
  }

  return (
    <>
      <h1 className={catalogStyles.title}>Программа благодарности</h1>
      <p className={catalogStyles.muted} style={{ marginBottom: 16, maxWidth: 640 }}>
        При достижении порога суммы товаров (после промокода) в заказ добавляются все подарки
        из подходящего правила. OOS-варианты пропускаются.
      </p>

      <form onSubmit={(e) => void onSave(e)}>
        <AdminTextField
          label="Slug статьи (опционально)"
          value={articleSlug}
          onChange={(e) => {
            setArticleSlug(e.target.value);
            markDirty();
          }}
          disabled={saving}
          maxLength={120}
        />

        <h2 className={catalogStyles.sectionTitle} style={{ marginTop: 24 }}>
          Правила подарков
        </h2>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onRulesDragEnd}>
          <SortableContext items={rules.map((r) => r.key)} strategy={verticalListSortingStrategy}>
            <ul className={styles.faqList}>
              {rules.map((item) => (
                <SortableRuleRow
                  key={item.key}
                  item={item}
                  disabled={saving}
                  onChange={(patch) => {
                    setRules((prev) =>
                      prev.map((r) => (r.key === item.key ? { ...r, ...patch } : r)),
                    );
                    markDirty();
                  }}
                  onRemove={() => {
                    setRules((prev) => prev.filter((r) => r.key !== item.key));
                    markDirty();
                  }}
                  onAddGift={() => setPickerKey(item.key)}
                  onRemoveGift={(variantId) => {
                    setRules((prev) =>
                      prev.map((r) =>
                        r.key === item.key
                          ? { ...r, gifts: r.gifts.filter((g) => g.variantId !== variantId) }
                          : r,
                      ),
                    );
                    markDirty();
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <AdminCompactBtn
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => {
            setRules((prev) => [
              ...prev,
              {
                key: newKey(),
                minRub: '',
                maxRub: '',
                gifts: [],
                active: true,
              },
            ]);
            markDirty();
          }}
          style={{ marginBottom: 24 }}
        >
          Добавить правило
        </AdminCompactBtn>

        <h2 className={catalogStyles.sectionTitle}>Блоки на landing (tiers)</h2>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onTiersDragEnd}>
          <SortableContext items={tiers.map((t) => t.key)} strategy={verticalListSortingStrategy}>
            <ul className={styles.faqList}>
              {tiers.map((item) => (
                <SortableTierRow
                  key={item.key}
                  item={item}
                  disabled={saving}
                  onChange={(patch) => {
                    setTiers((prev) =>
                      prev.map((t) => (t.key === item.key ? { ...t, ...patch } : t)),
                    );
                    markDirty();
                  }}
                  onRemove={() => {
                    setTiers((prev) => prev.filter((t) => t.key !== item.key));
                    markDirty();
                  }}
                  onUpload={async (file) => {
                    try {
                      const url = await uploadImage(file);
                      setTiers((prev) =>
                        prev.map((t) => (t.key === item.key ? { ...t, imageUrl: url } : t)),
                      );
                      markDirty();
                    } catch {
                      showToast('Не удалось загрузить изображение');
                    }
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <AdminCompactBtn
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => {
            setTiers((prev) => [
              ...prev,
              { key: newKey(), title: '', infoHtml: '', imageUrl: '', active: true },
            ]);
            markDirty();
          }}
          style={{ marginBottom: 24 }}
        >
          Добавить блок
        </AdminCompactBtn>

        <AdminCompactBtn type="submit" disabled={!loadedOk || saving || !dirty}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </AdminCompactBtn>
      </form>

      <VariantPickerModal
        open={pickerKey != null}
        selectedVariantId=""
        selectedLabel=""
        onClose={() => setPickerKey(null)}
        onApply={(variantId, label, details) => {
          if (!pickerKey) return;
          setRules((prev) =>
            prev.map((r) => {
              if (r.key !== pickerKey) return r;
              if (r.gifts.some((g) => g.variantId === variantId)) return r;
              return {
                ...r,
                gifts: [
                  ...r.gifts,
                  {
                    variantId,
                    label,
                    thumbnailUrl: null,
                  },
                ],
              };
            }),
          );
          void details;
          markDirty();
          setPickerKey(null);
        }}
      />
    </>
  );
}
