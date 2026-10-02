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
  const hasInactive = shown.some((i) => !i.active);
  return (
    <aside className={styles.aside} aria-label="Превью блока на главной">
      <div className={styles.preview}>
        <div className={styles.previewHead}>
          <p className={styles.previewTitle}>Как на главной</p>
          <p className={styles.previewWords}>
            <span className={titleLeft.trim() ? '' : styles.previewWordsMuted}>
              {titleLeft.trim() || 'Текст слева'}
            </span>
            {' · '}
            <span className={titleRight.trim() ? '' : styles.previewWordsMuted}>
              {titleRight.trim() || 'Текст справа'}
            </span>
          </p>
        </div>
        <div className={styles.previewFan}>
          {shown.length === 0 ? (
            <div className={styles.previewEmpty}>
              Загрузите изображения в карточки — здесь появится веер
            </div>
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
          Слева направо — порядок карточек. Перетаскивайте строки в списке, чтобы изменить порядок.
        </p>
        {shown.length > 0 ? (
          <div className={styles.previewLegend}>
            <span className={styles.previewLegendItem}>
              <span className={`${styles.previewLegendDot} ${styles.previewLegendDotActive}`} />
              активные
            </span>
            {hasInactive ? (
              <span className={styles.previewLegendItem}>
                <span className={`${styles.previewLegendDot} ${styles.previewLegendDotMuted}`} />
                скрытые
              </span>
            ) : null}
            <span className={styles.previewLegendItem}>вырез справа — как на витрине</span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function SortablePromoRow({
  index,
  item,
  disabled,
  onChange,
  onRemoveRequest,
  onUpload,
}: {
  index: number;
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

  const missingImage = !item.imageUrl.trim();

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={[
        styles.promoCard,
        isDragging ? styles.promoCardDragging : '',
        item.active ? '' : styles.promoCardInactive,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.promoCardHead}>
        <button
          type="button"
          className={styles.dragBtn}
          {...attributes}
          {...listeners}
          aria-label="Изменить порядок"
          disabled={disabled}
        >
          ⋮⋮
        </button>
        <span className={styles.promoCardIndex}>{index + 1}</span>
        <span className={styles.promoCardHeadTitle}>
          {missingImage ? 'Нужно изображение' : item.alt.trim() || 'Без подписи'}
        </span>
        <div className={styles.promoCardHeadActions}>
          <label className={styles.activeLabel}>
            <AdminCheckbox
              checked={item.active}
              onChange={(e) => onChange({ active: e.target.checked })}
              disabled={disabled}
            />
            На сайте
          </label>
          <AdminCompactBtn
            type="button"
            variant="danger"
            onClick={onRemoveRequest}
            disabled={disabled}
          >
            Удалить
          </AdminCompactBtn>
        </div>
      </div>

      <div className={styles.promoCardBody}>
        <div className={styles.imagePanel}>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className={styles.fileInputHidden}
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void onUpload(file);
            }}
          />
          {item.imageUrl ? (
            <div className={styles.imageFrame}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.imageThumb} src={item.imageUrl} alt="" />
              {item.notch ? <span className={styles.imageNotchBadge}>Вырез</span> : null}
            </div>
          ) : (
            <button
              type="button"
              className={`${styles.imageFrame} ${styles.imageFrameEmpty} ${
                disabled ? styles.imageFrameEmptyDisabled : ''
              }`}
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              <span className={styles.imageEmptyIcon} aria-hidden>
                ↑
              </span>
              <p className={styles.imageEmptyText}>JPEG, PNG, WebP или GIF</p>
            </button>
          )}
          <div className={styles.imageActions}>
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
        </div>

        <div className={styles.fieldsCol}>
          <div className={styles.fieldGroup}>
            <p className={styles.fieldGroupLabel}>Куда ведёт клик</p>
            <HomePromoLinkField
              href={item.href}
              disabled={disabled}
              onChange={(nextHref) => onChange({ href: nextHref })}
            />
          </div>

          <label className={catalogStyles.field}>
            <span className={catalogStyles.label}>Подпись для accessibility (alt)</span>
            <input
              className={catalogStyles.input}
              value={item.alt}
              disabled={disabled}
              placeholder="Например: Скидки на уход"
              onChange={(e) => onChange({ alt: e.target.value })}
            />
          </label>

          <div className={styles.optionsRow}>
            <label className={styles.activeLabel}>
              <AdminCheckbox
                checked={item.notch}
                onChange={(e) => onChange({ notch: e.target.checked })}
                disabled={disabled}
              />
              Вырез справа (форма карточки на главной)
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

  const statusLines = useMemo(() => {
    const lines: { text: string; tone: 'info' | 'warn' }[] = [];
    if (dirty) lines.push({ text: 'Есть несохранённые изменения', tone: 'info' });
    if (uploading) lines.push({ text: 'Загрузка изображения…', tone: 'info' });
    if (incompleteCount > 0) {
      lines.push({
        text: `У ${incompleteCount} карточек нет изображения — сохранение недоступно`,
        tone: 'warn',
      });
    }
    if (invalidHref) {
      lines.push({ text: 'Проверьте ссылки у всех карточек', tone: 'warn' });
    }
    if (items.length > MAX_ITEMS) {
      lines.push({ text: `Не больше ${MAX_ITEMS} карточек`, tone: 'warn' });
    }
    return lines;
  }, [dirty, uploading, incompleteCount, invalidHref, items.length]);

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

  function addCard() {
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
  const canAdd = canEdit && !saving && items.length < MAX_ITEMS;

  return (
    <div className={styles.page}>
      <div className={settingsStyles.hubHeader}>
        <h1 className={`${catalogStyles.title} ${settingsStyles.hubHeaderTitle}`}>Промо на главной</h1>
        <a
          className={settingsStyles.storefrontLink}
          href="/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Открыть главную ↗
        </a>
      </div>
      <p className={styles.lead}>
        Заголовок секции и до {MAX_ITEMS} кликабельных карточек: на десктопе — веер, на телефоне —
        горизонтальный слайдер.
      </p>

      <AdminSettingsListErrors
        loadError={loadError}
        actionError={actionError}
        onRetry={() => void load()}
        onDismissLoad={() => setLoadError(null)}
        onDismissAction={() => setActionError(null)}
      />

      {loading ? (
        <p className={styles.lead}>Загрузка…</p>
      ) : !loadedOk ? (
        <p className={styles.lead}>
          Не удалось загрузить промо. Нажмите «Повторить» — сохранение отключено, чтобы не стереть
          данные.
        </p>
      ) : (
        <form onSubmit={(e) => void onSave(e)}>
          {statusLines.length > 0 ? (
            <div
              className={`${styles.statusBar} ${
                statusLines.some((l) => l.tone === 'warn')
                  ? styles.statusBarWarn
                  : styles.statusBarInfo
              }`}
              role="status"
            >
              {statusLines.map((line) => (
                <span key={line.text}>{line.text}</span>
              ))}
            </div>
          ) : null}

          <div className={styles.layout}>
            <div className={styles.main}>
              <section className={styles.panel} aria-labelledby="promo-title-heading">
                <div className={styles.sectionHead}>
                  <div>
                    <h2 id="promo-title-heading" className={styles.sectionTitle}>
                      Заголовок секции
                    </h2>
                    <p className={styles.sectionDesc}>
                      Две части заголовка над карточками — обычно «НАШИ» и «АКЦИИ».
                    </p>
                  </div>
                </div>
                <div className={styles.titleGrid}>
                  <label className={catalogStyles.field}>
                    <span className={catalogStyles.label}>Слева</span>
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
                    <span className={catalogStyles.label}>Справа</span>
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
              </section>

              <section className={styles.panel} aria-labelledby="promo-cards-heading">
                <div className={styles.sectionHead}>
                  <div>
                    <h2 id="promo-cards-heading" className={styles.sectionTitle}>
                      Карточки
                    </h2>
                    <p className={styles.sectionDesc}>
                      Перетащите за ⋮⋮, чтобы изменить порядок. Сохраните, чтобы обновить главную.
                    </p>
                  </div>
                  <span className={styles.sectionBadge}>
                    {items.length} / {MAX_ITEMS}
                  </span>
                </div>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext
                    items={items.map((i) => i.key)}
                    strategy={verticalListSortingStrategy}
                  >
                    {items.length === 0 ? (
                      <div className={styles.emptyCards}>
                        <p className={styles.emptyCardsTitle}>Пока нет карточек</p>
                        <p className={styles.emptyCardsDesc}>
                          Добавьте первую — загрузите баннер и выберите, куда ведёт ссылка.
                        </p>
                        <AdminCompactBtn type="button" variant="accent" disabled={!canAdd} onClick={addCard}>
                          Добавить карточку
                        </AdminCompactBtn>
                      </div>
                    ) : (
                      <ul className={styles.cardList}>
                        {items.map((item, index) => (
                          <SortablePromoRow
                            key={item.key}
                            index={index}
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
                    )}
                  </SortableContext>
                </DndContext>

                {items.length > 0 ? (
                  <div className={styles.pageFooter}>
                    <p className={styles.pageFooterHint}>
                      {canAdd ? 'Можно добавить ещё карточки до лимита' : `Достигнут лимит ${MAX_ITEMS}`}
                    </p>
                    <div className={styles.pageFooterActions}>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        disabled={!canAdd}
                        onClick={addCard}
                      >
                        Добавить карточку
                      </AdminCompactBtn>
                    </div>
                  </div>
                ) : null}
              </section>

              <div className={styles.pageFooter}>
                <p className={styles.pageFooterHint}>
                  {dirty ? 'Не забудьте сохранить перед выходом' : 'Все изменения на сайте'}
                </p>
                <div className={styles.pageFooterActions}>
                  <AdminCompactBtn type="submit" variant="accent" disabled={!canSave}>
                    {saving ? 'Сохранение…' : 'Сохранить'}
                  </AdminCompactBtn>
                </div>
              </div>
            </div>

            <LayoutPreview titleLeft={titleLeft} titleRight={titleRight} items={items} />
          </div>
        </form>
      )}

      <AdminConfirmDialog
        open={deleteKey != null}
        title="Удалить карточку?"
        message="Карточка исчезнет из списка. Нажмите «Сохранить», чтобы убрать её с главной."
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
