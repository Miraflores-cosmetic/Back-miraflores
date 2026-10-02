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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminConfirmDialog } from '@/components/admin/AdminModal/AdminConfirmDialog';
import { AdminSettingsListErrors } from '@/components/admin/AdminSettingsListErrors/AdminSettingsListErrors';
import { useToast } from '@/components/Toast/ToastProvider';
import { adminBackendFetch, adminBackendJson } from '@/lib/adminBackendFetch';
import { useAdminSettingsListShell } from '@/lib/useAdminSettingsListShell';
import { revalidateHomeStorefront } from '@/lib/revalidateHomeStorefront';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import settingsStyles from '@/app/(admin)/admin/settings/Settings.module.css';
import { HomePromoLinkField, isPromoHrefComplete } from './HomePromoLinkField';
import styles from './HomePromoAdmin.module.css';

const MAX_ITEMS = 5;

type PromoDraft = {
  key: string;
  id?: string;
  imageUrl: string;
  href: string;
  alt: string;
  notch: boolean;
  active: boolean;
};

type PromoApiItem = {
  id: string;
  imageUrl: string;
  href: string;
  alt: string;
  notch: boolean;
  sortOrder: number;
  active: boolean;
};

type PromoApiResponse = {
  titleLeft: string;
  titleRight: string;
  items: PromoApiItem[];
};

function newKey() {
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await adminBackendFetch('catalog/admin/upload-rich-media?type=image', {
    method: 'POST',
    body: fd,
  });
  const data = (await res.json()) as { url?: string };
  if (!res.ok || !data.url) {
    throw new Error('Не удалось загрузить изображение');
  }
  return data.url;
}

function LayoutPreview({
  titleLeft,
  titleRight,
  items,
}: {
  titleLeft: string;
  titleRight: string;
  items: PromoDraft[];
}) {
  const shown = items.filter((i) => i.imageUrl.trim());
  return (
    <div className={styles.preview}>
      <div className={styles.previewHead}>
        <p className={styles.previewTitle}>Превью раскладки</p>
        <p className={styles.previewWords}>
          {titleLeft || '…'} · {titleRight || '…'}
        </p>
      </div>
      <div className={styles.previewFan}>
        {shown.length === 0 ? (
          <div className={styles.previewEmpty}>Нет карточек с картинкой</div>
        ) : (
          shown.map((item, index) => (
            <div
              key={item.key}
              className={[
                styles.previewCard,
                item.notch ? styles.previewCardNotch : '',
                item.active ? '' : styles.previewCardInactive,
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                zIndex: index + 1,
                transform: `rotate(${(index - (shown.length - 1) / 2) * 5}deg)`,
              }}
              title={item.href}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.previewImg} src={item.imageUrl} alt="" />
            </div>
          ))
        )}
      </div>
      <p className={styles.previewHint}>
        Слева направо — порядок на сайте. Неактивные приглушены. Вырез справа — как на витрине.
      </p>
    </div>
  );
}

function SortablePromoRow({
  item,
  disabled,
  onChange,
  onRemoveRequest,
  onUpload,
}: {
  item: PromoDraft;
  disabled: boolean;
  onChange: (patch: Partial<PromoDraft>) => void;
  onRemoveRequest: () => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
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
      className={`${settingsStyles.faqCard} ${isDragging ? settingsStyles.faqCardDragging : ''}`}
    >
      <div className={settingsStyles.faqCardHead}>
        <button
          type="button"
          className={settingsStyles.dragBtn}
          {...attributes}
          {...listeners}
          aria-label="Перетащить"
          disabled={disabled}
        >
          ⋮⋮
        </button>
        <label className={settingsStyles.activeLabel}>
          <AdminCheckbox
            checked={item.active}
            onChange={(e) => onChange({ active: e.target.checked })}
            disabled={disabled}
          />
          Активна
        </label>
        <AdminCompactBtn
          type="button"
          variant="danger"
          onClick={onRemoveRequest}
          disabled={disabled}
          aria-label="Удалить"
        >
          Удалить
        </AdminCompactBtn>
      </div>

      <div className={styles.cardFields}>
        <div className={styles.imageCol}>
          <p className={settingsStyles.heroImageLabel}>Баннер</p>
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={settingsStyles.heroThumb} src={item.imageUrl} alt="" />
          ) : (
            <p className={catalogStyles.lead}>Не выбрано</p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className={settingsStyles.heroFileInput}
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void onUpload(file);
            }}
          />
          <AdminCompactBtn
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
          >
            {item.imageUrl ? 'Заменить' : 'Загрузить'}
          </AdminCompactBtn>
          {item.imageUrl ? (
            <AdminCompactBtn
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => onChange({ imageUrl: '' })}
            >
              Убрать
            </AdminCompactBtn>
          ) : null}
        </div>

        <div className={styles.metaCol}>
          <HomePromoLinkField
            href={item.href}
            disabled={disabled}
            onChange={(nextHref) => onChange({ href: nextHref })}
          />

          <label className={catalogStyles.field}>
            <span className={catalogStyles.label}>Подпись (alt)</span>
            <input
              className={catalogStyles.input}
              value={item.alt}
              disabled={disabled}
              placeholder="Краткое описание"
              onChange={(e) => onChange({ alt: e.target.value })}
            />
          </label>

          <div className={styles.checkRow}>
            <label className={settingsStyles.activeLabel}>
              <AdminCheckbox
                checked={item.notch}
                onChange={(e) => onChange({ notch: e.target.checked })}
                disabled={disabled}
              />
              Вырез справа
            </label>
          </div>
        </div>
      </div>
    </li>
  );
}

export function HomePromoAdminClient() {
  const { showToast } = useToast();
  const shell = useAdminSettingsListShell();
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
    failAction,
    setActionError,
    setLoadError,
  } = shell;
  const [uploading, setUploading] = useState(false);
  const [titleLeft, setTitleLeft] = useState('НАШИ');
  const [titleRight, setTitleRight] = useState('АКЦИИ');
  const [items, setItems] = useState<PromoDraft[]>([]);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const incompleteCount = useMemo(
    () => items.filter((it) => !it.imageUrl.trim()).length,
    [items],
  );
  const invalidHref = useMemo(
    () => items.some((it) => !isPromoHrefComplete(it.href)),
    [items],
  );

  const load = useCallback(async () => {
    beginLoad();
    try {
      const data = await adminBackendJson<PromoApiResponse>('settings/admin/home-promo');
      setTitleLeft(data.titleLeft || 'НАШИ');
      setTitleRight(data.titleRight || 'АКЦИИ');
      setItems(
        (data.items ?? []).map((it) => ({
          key: it.id,
          id: it.id,
          imageUrl: it.imageUrl,
          href: it.href || '/catalog',
          alt: it.alt || '',
          notch: it.notch,
          active: it.active,
        })),
      );
      succeedLoad();
    } catch (e) {
      setItems([]);
      failLoad(e);
    }
  }, [beginLoad, succeedLoad, failLoad]);

  useEffect(() => {
    void load();
  }, [load]);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i.key === active.id);
      const newIndex = prev.findIndex((i) => i.key === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      markDirty();
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  async function onUpload(key: string, file: File) {
    setUploading(true);
    setActionError(null);
    try {
      const url = await uploadImage(file);
      markDirty();
      setItems((prev) => prev.map((row) => (row.key === key ? { ...row, imageUrl: url } : row)));
    } catch (err) {
      showToast(failAction(err, 'Ошибка загрузки'));
    } finally {
      setUploading(false);
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!loadedOk) return;
    if (incompleteCount > 0 || invalidHref || items.length > MAX_ITEMS) return;

    const payload = {
      titleLeft: titleLeft.trim() || 'НАШИ',
      titleRight: titleRight.trim() || 'АКЦИИ',
      items: items.map((it) => ({
        ...(it.id ? { id: it.id } : {}),
        imageUrl: it.imageUrl.trim(),
        href: it.href.trim() || '/catalog',
        alt: it.alt.trim(),
        notch: it.notch,
        active: it.active,
      })),
    };

    beginSave();
    try {
      const data = await adminBackendJson<PromoApiResponse>('settings/admin/home-promo', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setTitleLeft(data.titleLeft || 'НАШИ');
      setTitleRight(data.titleRight || 'АКЦИИ');
      setItems(
        (data.items ?? []).map((it) => ({
          key: it.id,
          id: it.id,
          imageUrl: it.imageUrl,
          href: it.href || '/catalog',
          alt: it.alt || '',
          notch: it.notch,
          active: it.active,
        })),
      );
      succeedSave();
      showToast('Промо сохранено');
      const revalidated = await revalidateHomeStorefront();
      if (!revalidated) {
        showToast('Сохранено, но кэш витрины не обновился — обновите главную вручную');
      }
    } catch (err) {
      showToast(failSave(err));
    }
  }

  const canEdit = loadedOk && !loading && !uploading;
  const canSave =
    canEdit && dirty && !saving && incompleteCount === 0 && !invalidHref && items.length <= MAX_ITEMS;

  return (
    <div>
      <div className={settingsStyles.hubHeader}>
        <h1 className={`${catalogStyles.title} ${settingsStyles.hubHeaderTitle}`}>Промо</h1>
        <a
          className={settingsStyles.storefrontLink}
          href="/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Открыть главную ↗
        </a>
      </div>
      <p className={catalogStyles.lead}>
        Блок на главной: заголовок и до {MAX_ITEMS} карточек (веер на десктопе, слайдер на мобиле).
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
          Не удалось загрузить промо. Нажмите «Повторить» — сохранение отключено, чтобы не стереть
          данные.
        </p>
      ) : (
        <form
          onSubmit={(e) => void onSave(e)}
          className={`${catalogStyles.form} ${catalogStyles.formWide}`}
        >
          {dirty ? <p className={catalogStyles.lead}>Несохранённые изменения</p> : null}
          {uploading ? <p className={catalogStyles.lead}>Загрузка изображения…</p> : null}
          {incompleteCount > 0 ? (
            <p className={catalogStyles.lead}>
              Есть карточки без картинки ({incompleteCount}) — сохранение недоступно
            </p>
          ) : null}
          {invalidHref ? (
            <p className={catalogStyles.lead}>
              Есть карточки без корректной ссылки — сохранение недоступно
            </p>
          ) : null}

          <div className={styles.titleRow}>
            <label className={catalogStyles.field}>
              <span className={catalogStyles.label}>Текст слева</span>
              <input
                className={catalogStyles.input}
                value={titleLeft}
                disabled={saving}
                onChange={(e) => {
                  markDirty();
                  setTitleLeft(e.target.value);
                }}
              />
            </label>
            <label className={catalogStyles.field}>
              <span className={catalogStyles.label}>Текст справа</span>
              <input
                className={catalogStyles.input}
                value={titleRight}
                disabled={saving}
                onChange={(e) => {
                  markDirty();
                  setTitleRight(e.target.value);
                }}
              />
            </label>
          </div>

          <LayoutPreview titleLeft={titleLeft} titleRight={titleRight} items={items} />

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={items.map((i) => i.key)}
              strategy={verticalListSortingStrategy}
            >
              <ul className={settingsStyles.faqList}>
                {items.map((item, index) => (
                  <SortablePromoRow
                    key={item.key}
                    item={item}
                    disabled={saving || uploading}
                    onChange={(patch) => {
                      markDirty();
                      setItems((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
                      );
                    }}
                    onRemoveRequest={() => setDeleteKey(item.key)}
                    onUpload={(file) => onUpload(item.key, file)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          {items.length === 0 ? (
            <p className={catalogStyles.lead}>Карточек пока нет</p>
          ) : null}

          <div className={catalogStyles.formActions}>
            <AdminCompactBtn
              type="button"
              variant="outline"
              disabled={saving || uploading || items.length >= MAX_ITEMS}
              onClick={() => {
                markDirty();
                setItems((prev) => [
                  ...prev,
                  {
                    key: newKey(),
                    imageUrl: '',
                    href: '/catalog',
                    alt: '',
                    notch: false,
                    active: true,
                  },
                ]);
              }}
            >
              {items.length >= MAX_ITEMS ? `Макс. ${MAX_ITEMS} карточек` : 'Добавить карточку'}
            </AdminCompactBtn>
            <AdminCompactBtn type="submit" variant="accent" disabled={!canSave}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </AdminCompactBtn>
          </div>
        </form>
      )}

      <AdminConfirmDialog
        open={deleteKey != null}
        title="Удалить карточку?"
        message="Карточка будет убрана из списка. Сохраните изменения, чтобы применить на сайте."
        confirmLabel="Удалить"
        danger
        onCancel={() => setDeleteKey(null)}
        onConfirm={() => {
          if (!deleteKey) return;
          markDirty();
          setItems((prev) => prev.filter((row) => row.key !== deleteKey));
          setDeleteKey(null);
        }}
      />
    </div>
  );
}
