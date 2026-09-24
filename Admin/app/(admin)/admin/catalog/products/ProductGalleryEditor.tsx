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
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminConfirmDialog } from '@/components/admin/AdminModal/AdminConfirmDialog';
import {
  AdminBackendRequestError,
  adminBackendFetch,
  adminBackendJson,
  readAdminApiError,
} from '@/lib/adminBackendFetch';
import { revalidateCatalogStorefront } from '@/lib/revalidateCatalogStorefront';
import styles from './ProductGallery.module.css';

export type GalleryImage = {
  id: string;
  url: string;
  sortOrder: number;
  mediaType?: 'image' | 'video';
};

function isVideo(item: GalleryImage): boolean {
  if (item.mediaType === 'video') return true;
  return /\.(mp4|mov)(\?|$)/i.test(item.url);
}

/** 1 кадр, 2 кадра, 5 кадров */
function formatRuFrames(n: number): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return `${n} кадров`;
  if (d === 1) return `${n} кадр`;
  if (d >= 2 && d <= 4) return `${n} кадра`;
  return `${n} кадров`;
}

function GalleryMedia({
  item,
  className,
  alt,
}: {
  item: GalleryImage;
  className?: string;
  alt?: string;
}) {
  if (isVideo(item)) {
    return (
      <video
        className={className}
        src={item.url}
        muted
        playsInline
        preload="metadata"
        controls
        aria-label={alt || 'Видео'}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={item.url} alt={alt || ''} loading="lazy" />;
}

function SortableGalleryTile({
  image,
  index,
  busy,
  onRemove,
  onPreview,
}: {
  image: GalleryImage;
  index: number;
  busy: boolean;
  onRemove: () => void;
  onPreview: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
    disabled: busy,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`${styles.tile} ${isDragging ? styles.tileDragging : ''}`}
    >
      <button
        type="button"
        className={styles.previewBtn}
        onClick={onPreview}
        aria-label={`Просмотр кадра ${index + 1}`}
      >
        <GalleryMedia item={image} className={styles.thumb} alt="" />
      </button>
      {index === 0 ? <span className={styles.coverBadge}>Обложка</span> : null}
      {isVideo(image) ? <span className={styles.orderBadge}>видео</span> : null}
      {index > 0 && !isVideo(image) ? <span className={styles.orderBadge}>{index + 1}</span> : null}
      <div className={styles.tileActions}>
        <button
          type="button"
          className={styles.dragBtn}
          {...attributes}
          {...listeners}
          aria-label="Перетащить"
          disabled={busy}
        >
          ⋮⋮
        </button>
        <button
          type="button"
          className={styles.removeBtn}
          onClick={onRemove}
          aria-label="Удалить кадр"
          disabled={busy}
        />
      </div>
    </li>
  );
}

function GalleryLightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: GalleryImage[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const image = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1);
      if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasNext, hasPrev, index, onClose, onIndexChange]);

  if (!image) return null;

  return (
    <div className={styles.lightboxBackdrop} role="dialog" aria-modal="true">
      <div className={styles.lightboxToolbar}>
        <span className={styles.lightboxCounter}>
          {index + 1} / {images.length}
        </span>
        <button type="button" className={styles.lightboxCloseBtn} onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      {hasPrev ? (
        <button
          type="button"
          className={`${styles.lightboxNav} ${styles.lightboxNavPrev}`}
          onClick={() => onIndexChange(index - 1)}
          aria-label="Предыдущий"
        >
          ‹
        </button>
      ) : null}
      <GalleryMedia item={image} className={styles.lightboxImage} alt="" />
      {hasNext ? (
        <button
          type="button"
          className={`${styles.lightboxNav} ${styles.lightboxNavNext}`}
          onClick={() => onIndexChange(index + 1)}
          aria-label="Следующий"
        >
          ›
        </button>
      ) : null}
    </div>
  );
}

export function ProductGalleryEditor({
  productId,
  images,
  onChange,
  api,
  title = 'Галерея',
  acceptVideo = true,
  productSlug,
  onPersisted,
}: {
  productId?: string;
  images: GalleryImage[];
  onChange: (next: GalleryImage[]) => void;
  /** Если задан — пути API; иначе нужны пути каталога через productId. */
  api?: {
    uploadPath: string;
    reorderPath: string;
    deletePath: (imageId: string) => string;
  };
  title?: string;
  acceptVideo?: boolean;
  /** Для revalidate витрины после мгновенных правок галереи. */
  productSlug?: string;
  onPersisted?: () => void;
}) {
  const paths = api ?? {
    uploadPath: `catalog/admin/products/${productId}/images`,
    reorderPath: `catalog/admin/products/${productId}/images/reorder`,
    deletePath: (imageId: string) => `catalog/admin/images/${imageId}`,
  };
  const accept = acceptVideo
    ? 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,.mp4,.mov'
    : 'image/jpeg,image/png,image/webp,image/gif';

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function afterPersist() {
    await revalidateCatalogStorefront({ productSlug: productSlug || undefined });
    onPersisted?.();
  }

  async function onPick(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    setBusy(true);
    setError(null);
    let nextImages = images;
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await adminBackendFetch(paths.uploadPath, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) throw new AdminBackendRequestError(await readAdminApiError(res), res.status);
        const img = (await res.json()) as GalleryImage;
        nextImages = [...nextImages, img];
        onChange(nextImages);
      }
      await afterPersist();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function confirmRemove() {
    const id = pendingDeleteId;
    if (!id) return;
    setPendingDeleteId(null);
    setBusy(true);
    setError(null);
    try {
      await adminBackendJson(paths.deletePath(id), { method: 'DELETE' });
      onChange(images.filter((i) => i.id !== id));
      await afterPersist();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось удалить');
    } finally {
      setBusy(false);
    }
  }

  async function persistOrder(next: GalleryImage[]) {
    setBusy(true);
    setError(null);
    try {
      await adminBackendJson(paths.reorderPath, {
        method: 'PATCH',
        body: JSON.stringify({ imageIds: next.map((i) => i.id) }),
      });
      await afterPersist();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось изменить порядок');
      onChange(images);
    } finally {
      setBusy(false);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = images.findIndex((i) => i.id === active.id);
    const newIndex = images.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(images, oldIndex, newIndex).map((img, sortOrder) => ({
      ...img,
      sortOrder,
    }));
    onChange(next);
    void persistOrder(next);
  }

  return (
    <section className={styles.root}>
      <div className={styles.metaRow}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.count}>
          {images.length === 0 ? 'Нет кадров' : formatRuFrames(images.length)}
        </p>
        <AdminCompactBtn
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? '…' : 'Добавить'}
        </AdminCompactBtn>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className={styles.fileInput}
          onChange={(e) => void onPick(e.target.files)}
        />
      </div>
      <p className={styles.hint}>Изменения галереи сохраняются сразу. Можно выбрать несколько файлов.</p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={images.map((i) => i.id)} strategy={rectSortingStrategy}>
          <ul className={styles.grid}>
            {images.map((img, index) => (
              <SortableGalleryTile
                key={img.id}
                image={img}
                index={index}
                busy={busy}
                onRemove={() => setPendingDeleteId(img.id)}
                onPreview={() => setPreviewIndex(index)}
              />
            ))}
            <li className={`${styles.tile} ${styles.tileAdd}`}>
              <button
                type="button"
                className={styles.addTile}
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                aria-label={acceptVideo ? 'Добавить изображение или видео' : 'Добавить изображение'}
              >
                <span className={styles.addIcon} aria-hidden>
                  +
                </span>
              </button>
            </li>
          </ul>
        </SortableContext>
      </DndContext>

      {previewIndex != null ? (
        <GalleryLightbox
          images={images}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
          onIndexChange={setPreviewIndex}
        />
      ) : null}

      <AdminConfirmDialog
        open={pendingDeleteId != null}
        title="Удалить кадр?"
        message="Кадр будет удалён из галереи товара. Это действие нельзя отменить."
        confirmLabel="Удалить"
        danger
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  );
}
