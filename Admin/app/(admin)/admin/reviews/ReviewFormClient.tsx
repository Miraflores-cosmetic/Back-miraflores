'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DiscountProductPickerModal } from '@/app/(admin)/admin/discounts/DiscountScopePickerModal';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import {
  AdminSelect,
  AdminTextArea,
  AdminTextField,
} from '@/components/AdminTextField/AdminTextField';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime } from '@/lib/adminFormat';
import type { AdminReviewRow } from '@/lib/adminReviewsTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';
import { ReviewMediaField } from './ReviewMediaField';

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

export function ReviewFormClient({ reviewId: reviewIdProp }: { reviewId?: string }) {
  const router = useRouter();
  const { showToast } = useToast();

  const [reviewId, setReviewId] = useState(reviewIdProp);
  const isEdit = Boolean(reviewId);

  const [loading, setLoading] = useState(Boolean(reviewIdProp));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState<string | null>(null);
  const [productSlug, setProductSlug] = useState<string | null>(null);
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [moderatedAt, setModeratedAt] = useState<string | null>(null);
  const [rejectedAt, setRejectedAt] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  /** Отображаемый слот (image1, иначе image2). */
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [savedImage1Url, setSavedImage1Url] = useState<string | null>(null);
  const [savedImage2Url, setSavedImage2Url] = useState<string | null>(null);
  const [mediaTouched, setMediaTouched] = useState(false);

  function markDirty() {
    setDirty(true);
  }

  function applyRow(row: AdminReviewRow) {
    setReviewId(row.id);
    setProductId(row.product.id);
    setProductName(row.product.name);
    setProductSlug(row.product.slug);
    setUserLabel(row.user?.displayName?.trim() || row.user?.email || null);
    setOrderId(row.orderId);
    setCreatedAt(row.createdAt);
    setModeratedAt(row.moderatedAt);
    setRejectedAt(row.rejectedAt);
    setRejectionReason(row.rejectionReason);
    setRating(row.rating);
    setText(row.text);
    setAuthorName(row.authorName ?? '');
    setIsPublished(row.isPublished);
    const img1 = row.image1Url?.trim() || null;
    const img2 = row.image2Url?.trim() || null;
    setSavedImage1Url(img1);
    setSavedImage2Url(img2);
    setMediaUrl(img1 || img2);
    setMediaTouched(false);
    setDirty(false);
  }

  useEffect(() => {
    if (!reviewIdProp) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await adminBackendJson<AdminReviewRow>(`reviews/admin/${reviewIdProp}`);
        if (cancelled) return;
        applyRow(row);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per id
  }, [reviewIdProp]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  async function pickProduct(id: string, name: string) {
    setProductId(id);
    setProductName(name);
    markDirty();
    try {
      const p = await adminBackendJson<{ slug: string }>(`catalog/admin/products/${id}`);
      setProductSlug(p.slug);
    } catch {
      setProductSlug(null);
    }
  }

  async function save() {
    if (!isEdit && !productId) {
      setError('Выберите товар');
      return;
    }

    const trimmed = text.trim();
    const nextMedia = mediaUrl?.trim() || null;
    if (trimmed.length > 2000) {
      setError('Текст отзыва — максимум 2000 символов');
      return;
    }

    let hasMedia: boolean;
    if (!mediaTouched) {
      hasMedia = Boolean(savedImage1Url || savedImage2Url);
    } else {
      // «Убрать» чистит оба слота; иначе в форме остаётся хотя бы одно медиа.
      hasMedia = Boolean(nextMedia);
    }

    if (!hasMedia && trimmed.length < 10) {
      setError('Текст — минимум 10 символов, если нет медиа');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      /** Не шлём image2Url: null «на всякий» — бэкенд иначе чистит второе фото с диска. */
      const mediaPatch = (): { image1Url?: string | null; image2Url?: string | null } => {
        if (!mediaTouched) return {};
        if (!nextMedia) {
          return { image1Url: null, image2Url: null };
        }
        // В UI один слот: правим тот, что был показан; второй не трогаем.
        if (savedImage1Url || !savedImage2Url) {
          return { image1Url: nextMedia };
        }
        return { image2Url: nextMedia };
      };

      if (isEdit && reviewId) {
        const row = await adminBackendJson<AdminReviewRow>(`reviews/admin/${reviewId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            rating,
            text: trimmed,
            authorName: authorName.trim() || null,
            isPublished,
            ...mediaPatch(),
          }),
        });
        applyRow(row);
        showToast('Отзыв сохранён');
        router.refresh();
      } else {
        const created = await adminBackendJson<AdminReviewRow>('reviews/admin', {
          method: 'POST',
          body: JSON.stringify({
            productId,
            rating,
            text: trimmed,
            authorName: authorName.trim() || null,
            isPublished,
            ...(nextMedia ? { image1Url: nextMedia } : {}),
          }),
        });
        applyRow(created);
        showToast('Отзыв создан');
        router.replace(`/admin/reviews/${created.id}`);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  async function deleteConfirmed() {
    if (!reviewId) return;
    setPendingDelete(false);
    setBusy(true);
    setError(null);
    try {
      await adminBackendJson(`reviews/admin/${reviewId}`, { method: 'DELETE' });
      showToast('Отзыв удалён');
      router.replace('/admin/reviews');
      router.refresh();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось удалить');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className={styles.muted}>Загрузка…</p>;
  }

  if (error && isEdit && !productId) {
    return (
      <p className={styles.error} role="alert">
        {error}{' '}
        <AdminCompactBtnLink href="/admin/reviews" variant="outline">
          К списку
        </AdminCompactBtnLink>
      </p>
    );
  }

  const titleText = isEdit ? 'Редактирование отзыва' : 'Новый отзыв';
  const storefrontHref = productSlug?.trim() ? `/product/${productSlug.trim()}` : null;

  return (
    <>
      <div className={pn.stickyToolbar}>
        <div className={pn.stickyToolbarMain}>
          <div className={pn.stickyToolbarNav}>
            <AdminCompactBtnLink href="/admin/reviews" variant="outline">
              ← К списку
            </AdminCompactBtnLink>
            {storefrontHref ? (
              <a
                className={pn.storefrontLink}
                href={storefrontHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                На витрине ↗
              </a>
            ) : null}
            {dirty ? <span className={pn.dirtyHintInline}>Несохранённые изменения</span> : null}
          </div>
          <h1 className={pn.stickyToolbarTitle}>{titleText}</h1>
        </div>
        <div className={pn.stickyToolbarActions}>
          {isEdit ? (
            <AdminCompactBtn
              type="button"
              variant="outline"
              className={styles.iconDangerBtn}
              disabled={busy || saving}
              onClick={() => setPendingDelete(true)}
              aria-label="Удалить отзыв"
              title="Удалить"
            >
              <TrashIcon />
            </AdminCompactBtn>
          ) : null}
          <AdminCompactBtn
            type="button"
            variant="accent"
            disabled={saving || busy}
            onClick={() => void save()}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </AdminCompactBtn>
        </div>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div
        className={styles.formWide}
        style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div>
          <p className={styles.cardNote} style={{ marginBottom: 8 }}>
            Товар
          </p>
          {isEdit ? (
            <p className={styles.cardNote}>
              {productId && productName ? (
                <Link href={`/admin/catalog/products/${productId}`}>{productName}</Link>
              ) : (
                '—'
              )}
              {createdAt ? (
                <>
                  <br />
                  Создан: {formatAdminDateTime(createdAt)}
                </>
              ) : null}
              {moderatedAt ? (
                <>
                  <br />
                  Модерация: {formatAdminDateTime(moderatedAt)}
                </>
              ) : null}
              {rejectedAt ? (
                <>
                  <br />
                  Отклонён: {formatAdminDateTime(rejectedAt)}
                  {rejectionReason ? (
                    <>
                      <br />
                      Причина: {rejectionReason}
                    </>
                  ) : null}
                </>
              ) : null}
              {orderId ? (
                <>
                  <br />
                  Заказ: <span className={styles.mutedInline}>{orderId}</span>
                </>
              ) : null}
              {userLabel ? (
                <>
                  <br />
                  Аккаунт: {userLabel}
                </>
              ) : null}
            </p>
          ) : (
            <div className={styles.toolbar}>
              {productName ? (
                <span>
                  {productName}{' '}
                  <AdminCompactBtn
                    type="button"
                    variant="outline"
                    onClick={() => setProductPickerOpen(true)}
                  >
                    Сменить
                  </AdminCompactBtn>
                </span>
              ) : (
                <AdminCompactBtn
                  type="button"
                  variant="outline"
                  onClick={() => setProductPickerOpen(true)}
                >
                  Выбрать товар
                </AdminCompactBtn>
              )}
            </div>
          )}
        </div>

        <AdminSelect
          label="Оценка"
          value={String(rating)}
          onChange={(e) => {
            markDirty();
            setRating(Number(e.target.value));
          }}
        >
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </AdminSelect>

        <AdminTextField
          label="Подпись автора"
          value={authorName}
          onChange={(e) => {
            markDirty();
            setAuthorName(e.target.value);
          }}
          placeholder="Покупатель (пусто — на витрине «Покупатель»)"
        />

        <AdminTextArea
          label="Текст"
          value={text}
          onChange={(e) => {
            markDirty();
            setText(e.target.value);
          }}
          rows={8}
          maxLength={2000}
        />

        <div className={styles.labelCheckboxRow}>
          <AdminCheckbox
            id="review-published"
            className={styles.adminCheckboxForm}
            checked={isPublished}
            onChange={(e) => {
              markDirty();
              setIsPublished(e.target.checked);
            }}
            aria-label="Опубликован"
          />
          <label htmlFor="review-published">Опубликован</label>
        </div>

        <ReviewMediaField
          url={mediaUrl}
          onChange={(next) => {
            markDirty();
            setMediaTouched(true);
            setMediaUrl(next);
          }}
        />
      </div>

      {!isEdit ? (
        <DiscountProductPickerModal
          open={productPickerOpen}
          single
          selectedIds={productId ? [productId] : []}
          selectedLabels={productId && productName ? { [productId]: productName } : {}}
          onClose={() => setProductPickerOpen(false)}
          onApply={(ids, labels) => {
            const id = ids[0];
            if (!id) {
              setProductId(null);
              setProductName(null);
              setProductSlug(null);
              markDirty();
              return;
            }
            void pickProduct(id, labels[id] ?? id);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete}
        title="Удалить отзыв?"
        message="Отзыв будет удалён безвозвратно."
        confirmLabel="Удалить"
        danger
        onConfirm={() => void deleteConfirmed()}
        onCancel={() => setPendingDelete(false)}
      />
    </>
  );
}
