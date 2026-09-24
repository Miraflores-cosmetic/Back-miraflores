'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminAccordion } from '@/components/admin/AdminAccordion/AdminAccordion';
import { AdminRichField } from '@/components/admin/AdminRichField/AdminRichField';
import {
  AdminSelect,
  AdminTextArea,
  AdminTextField,
} from '@/components/AdminTextField/AdminTextField';
import { AdminConfirmDialog } from '@/components/admin/AdminModal/AdminConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendFetch,
  adminBackendJson,
  adminBackendPath,
  readAdminApiError,
} from '@/lib/adminBackendFetch';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';
import type { AdminBlogCategoryRow, AdminBlogPostDetail } from './blogAdminTypes';
import { dateInputToIso, isoOrNowToDateInputValue } from './blogDateInput';
import blogStyles from './blogAdmin.module.css';

const BACK_HREF = '/admin/pages?tab=blog';

type Props = { postId?: string };

async function revalidateBlogStorefront(slug?: string) {
  try {
    await fetch('/api/admin/revalidate-blog', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slug ? { slug } : {}),
    });
  } catch {
    /* cache lag ok */
  }
}

function discardSessionUploads(urls: string[]) {
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (!unique.length) return;
  const body = JSON.stringify({ urls: unique });
  try {
    void fetch(adminBackendPath('blog/admin/discard-uploads'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    /* best-effort */
  }
}

export function BlogPostEditorClient({ postId }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const isEdit = Boolean(postId);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const sessionUploadsRef = useRef<Set<string>>(new Set());
  const savedMediaRef = useRef<Set<string>>(new Set());

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [categories, setCategories] = useState<AdminBlogCategoryRow[]>([]);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dateYmd, setDateYmd] = useState(() => isoOrNowToDateInputValue(null));
  const [excerpt, setExcerpt] = useState('');
  const [body, setBody] = useState('<p></p>');
  const [isPublished, setIsPublished] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [ogImageUrl, setOgImageUrl] = useState('');
  const [canonicalPath, setCanonicalPath] = useState('');
  const [seoNoIndex, setSeoNoIndex] = useState(false);

  function markDirty() {
    setDirty(true);
  }

  function trackUpload(url: string) {
    const t = url.trim();
    if (!t) return;
    sessionUploadsRef.current.add(t);
  }

  function markSavedMedia(nextCover: string | null, nextBody: string) {
    const kept = new Set<string>();
    if (nextCover?.trim()) kept.add(nextCover.trim());
    for (const m of nextBody.matchAll(/src=["']([^"']+)["']/gi)) {
      const u = m[1]?.trim();
      if (u) kept.add(u);
    }
    savedMediaRef.current = kept;
    for (const u of kept) sessionUploadsRef.current.delete(u);
  }

  useEffect(() => {
    void (async () => {
      try {
        const rows = await adminBackendJson<AdminBlogCategoryRow[]>('blog/admin/categories');
        setCategories(rows);
      } catch {
        setCategories([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadFailed(false);
      setError(null);
      try {
        const row = await adminBackendJson<AdminBlogPostDetail>(`blog/admin/posts/${postId}`);
        if (cancelled) return;
        setTitle(row.title);
        setSlug(row.slug);
        setCategoryId(row.categoryId ?? '');
        setDateYmd(isoOrNowToDateInputValue(row.publishedAt));
        setExcerpt(row.excerpt ?? '');
        setBody(row.body || '<p></p>');
        setIsPublished(row.isPublished);
        setCoverUrl(row.coverUrl);
        setMetaTitle(row.metaTitle ?? '');
        setMetaDescription(row.metaDescription ?? '');
        setOgImageUrl(row.ogImageUrl ?? '');
        setCanonicalPath(row.canonicalPath ?? '');
        setSeoNoIndex(Boolean(row.seoNoIndex));
        markSavedMedia(row.coverUrl, row.body || '');
        sessionUploadsRef.current.clear();
        setDirty(false);
      } catch (e) {
        if (!cancelled) {
          setLoadFailed(true);
          setError(
            e instanceof AdminBackendRequestError || e instanceof Error ? e.message : 'Ошибка',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  useEffect(() => {
    return () => {
      const orphans = [...sessionUploadsRef.current].filter(
        (u) => !savedMediaRef.current.has(u),
      );
      discardSessionUploads(orphans);
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  async function onCoverFile(file: File | null) {
    if (!file) return;
    setUploadingCover(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await adminBackendFetch('blog/admin/upload', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) throw new AdminBackendRequestError(await readAdminApiError(res), res.status);
      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error('Сервер не вернул URL обложки');
      const prev = coverUrl?.trim();
      if (prev && sessionUploadsRef.current.has(prev) && !savedMediaRef.current.has(prev)) {
        discardSessionUploads([prev]);
        sessionUploadsRef.current.delete(prev);
      }
      trackUpload(json.url);
      markDirty();
      setCoverUrl(json.url);
    } catch (e) {
      setError(
        e instanceof AdminBackendRequestError || e instanceof Error
          ? e.message
          : 'Не удалось загрузить обложку',
      );
    } finally {
      setUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  }

  async function onDeleteConfirm() {
    if (!postId) return;
    setDeleteConfirm(false);
    setDeleting(true);
    try {
      await adminBackendJson(`blog/admin/posts/${postId}`, { method: 'DELETE' });
      const orphans = [...sessionUploadsRef.current].filter(
        (u) => !savedMediaRef.current.has(u),
      );
      discardSessionUploads(orphans);
      sessionUploadsRef.current.clear();
      await revalidateBlogStorefront(slug.trim() || undefined);
      showToast('Статья удалена');
      router.push(BACK_HREF);
    } catch (err) {
      showToast(
        err instanceof AdminBackendRequestError || err instanceof Error
          ? err.message
          : 'Не удалось удалить',
      );
    } finally {
      setDeleting(false);
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (loadFailed) return;
    setSaving(true);
    setError(null);
    try {
      if (!title.trim()) throw new Error('Укажите заголовок');
      const payload = {
        title: title.trim(),
        slug: slug.trim() || undefined,
        categoryId: categoryId || null,
        excerpt: excerpt.trim() || null,
        body: body.trim() || '<p></p>',
        isPublished,
        publishedAt: dateInputToIso(dateYmd),
        coverUrl,
        metaTitle: metaTitle.trim() || null,
        metaDescription: metaDescription.trim() || null,
        ogImageUrl: ogImageUrl.trim() || null,
        canonicalPath: canonicalPath.trim() || null,
        seoNoIndex,
      };
      if (isEdit && postId) {
        const updated = await adminBackendJson<AdminBlogPostDetail>(
          `blog/admin/posts/${postId}`,
          { method: 'PATCH', body: JSON.stringify(payload) },
        );
        setSlug(updated.slug);
        setCoverUrl(updated.coverUrl);
        setBody(updated.body || '<p></p>');
        markSavedMedia(updated.coverUrl, updated.body || '');
        const leftovers = [...sessionUploadsRef.current];
        sessionUploadsRef.current.clear();
        discardSessionUploads(leftovers.filter((u) => !savedMediaRef.current.has(u)));
        await revalidateBlogStorefront(updated.slug);
        setDirty(false);
        showToast('Сохранено');
        router.refresh();
      } else {
        const created = await adminBackendJson<AdminBlogPostDetail>('blog/admin/posts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        markSavedMedia(created.coverUrl, created.body || '');
        const leftovers = [...sessionUploadsRef.current];
        sessionUploadsRef.current.clear();
        discardSessionUploads(leftovers.filter((u) => !savedMediaRef.current.has(u)));
        await revalidateBlogStorefront(created.slug);
        showToast('Статья создана');
        setDirty(false);
        router.replace(`/admin/blog/${created.id}`);
        router.refresh();
      }
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

  if (loading) return <p className={catalogStyles.muted}>Загрузка…</p>;

  if (loadFailed) {
    return (
      <div className={`${catalogStyles.form} ${catalogStyles.formWide}`}>
        <p className={`${catalogStyles.backRow} ${blogStyles.editorNav}`}>
          <AdminCompactBtnLink href={BACK_HREF} variant="outline">
            ← К списку
          </AdminCompactBtnLink>
        </p>
        <p className={catalogStyles.error} role="alert">
          {error ?? 'Не удалось загрузить статью'}
        </p>
        <p className={catalogStyles.muted}>
          Сохранение отключено, чтобы не затереть данные пустой формой.
        </p>
      </div>
    );
  }

  const titleText = title.trim() || (isEdit ? 'Статья' : 'Новая статья');

  return (
    <form
      onSubmit={(e) => void onSave(e)}
      className={`${catalogStyles.form} ${catalogStyles.formWide}`}
      style={{ gap: 14 }}
    >
      <div className={pn.stickyToolbar}>
        <div className={pn.stickyToolbarMain}>
          <div className={pn.stickyToolbarNav}>
            <AdminCompactBtnLink href={BACK_HREF} variant="outline">
              ← К списку
            </AdminCompactBtnLink>
            {isEdit && isPublished && slug ? (
              <a
                className={pn.storefrontLink}
                href={`/blog/${encodeURIComponent(slug)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                На сайте ↗
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
              variant="danger"
              disabled={saving || deleting || uploadingCover}
              onClick={() => setDeleteConfirm(true)}
            >
              Удалить
            </AdminCompactBtn>
          ) : null}
          <AdminCompactBtn
            type="submit"
            variant="accent"
            disabled={saving || deleting || uploadingCover || !dirty}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </AdminCompactBtn>
        </div>
      </div>

      {error ? (
        <p className={catalogStyles.error} role="alert">
          {error}
        </p>
      ) : null}

      <AdminTextField
        label="Заголовок"
        value={title}
        onChange={(e) => {
          markDirty();
          setTitle(e.target.value);
        }}
        required
      />
      <AdminSelect
        label="Рубрика"
        value={categoryId}
        onChange={(e) => {
          markDirty();
          setCategoryId(e.target.value);
        }}
      >
        <option value="">Без рубрики</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </AdminSelect>
      <AdminTextField
        label="Дата"
        type="date"
        value={dateYmd}
        onChange={(e) => {
          markDirty();
          setDateYmd(e.target.value);
        }}
      />
      <div>
        <AdminTextArea
          label="Лид / excerpt"
          value={excerpt}
          onChange={(e) => {
            markDirty();
            setExcerpt(e.target.value);
          }}
          rows={3}
        />
        <p className={catalogStyles.cardNote} style={{ marginTop: 6 }}>
          Короткий лид для списка и карточки на сайте. Plain text; HTML будет очищен при
          сохранении.
        </p>
      </div>

      <div className={catalogStyles.coverBlock}>
        <p className={catalogStyles.coverLabel}>Обложка</p>
        {coverUrl ? (
          <div className={catalogStyles.coverPreviewWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={catalogStyles.coverPreview} src={coverUrl} alt="" />
            <button
              type="button"
              className={catalogStyles.coverRemoveBtn}
              onClick={() => {
                const prev = coverUrl?.trim();
                if (
                  prev &&
                  sessionUploadsRef.current.has(prev) &&
                  !savedMediaRef.current.has(prev)
                ) {
                  discardSessionUploads([prev]);
                  sessionUploadsRef.current.delete(prev);
                }
                markDirty();
                setCoverUrl(null);
              }}
              disabled={uploadingCover}
              aria-label="Убрать обложку"
              title="Убрать"
            >
              ×
            </button>
          </div>
        ) : (
          <p className={catalogStyles.muted}>Не выбрана</p>
        )}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className={catalogStyles.coverFileInput}
          disabled={uploadingCover}
          onChange={(e) => void onCoverFile(e.target.files?.[0] ?? null)}
        />
        {uploadingCover ? <p className={catalogStyles.muted}>Загрузка…</p> : null}
      </div>

      <AdminTextField
        label="Slug"
        value={slug}
        onChange={(e) => {
          markDirty();
          setSlug(e.target.value);
        }}
        placeholder={isEdit ? undefined : 'пусто → авто из заголовка'}
      />

      <label className={blogStyles.publishedRow}>
        <AdminCheckbox
          checked={isPublished}
          onChange={(e) => {
            markDirty();
            setIsPublished(e.target.checked);
          }}
        />
        Опубликовано
      </label>

      <AdminRichField
        label="Текст статьи"
        value={body}
        onChange={(next) => {
          markDirty();
          setBody(next);
        }}
        uploadPath="blog/admin/upload"
        onUploaded={trackUpload}
        tall
      />

      <AdminAccordion title="SEO">
        <p className={pn.placementHint}>
          Пустые поля подставляются из заголовка, лида и обложки статьи.
        </p>
        <AdminTextField
          label="Meta title"
          value={metaTitle}
          onChange={(e) => {
            markDirty();
            setMetaTitle(e.target.value);
          }}
          maxLength={500}
        />
        <AdminTextArea
          label="Meta description"
          value={metaDescription}
          onChange={(e) => {
            markDirty();
            setMetaDescription(e.target.value);
          }}
          rows={3}
          maxLength={500}
        />
        <AdminTextField
          label="OG-картинка"
          value={ogImageUrl}
          onChange={(e) => {
            markDirty();
            setOgImageUrl(e.target.value);
          }}
          placeholder="/uploads/…"
        />
        <AdminTextField
          label="Canonical path"
          value={canonicalPath}
          onChange={(e) => {
            markDirty();
            setCanonicalPath(e.target.value);
          }}
          placeholder={slug.trim() ? `/articles/${slug.trim()}` : '/articles/slug'}
        />
        <label className={blogStyles.publishedRow}>
          <AdminCheckbox
            checked={seoNoIndex}
            onChange={(e) => {
              markDirty();
              setSeoNoIndex(e.target.checked);
            }}
          />
          Не индексировать (noindex)
        </label>
      </AdminAccordion>

      <AdminConfirmDialog
        open={deleteConfirm}
        title="Удалить статью?"
        message={`«${titleText}» будет удалена безвозвратно.`}
        confirmLabel="Удалить"
        danger
        onConfirm={() => void onDeleteConfirm()}
        onCancel={() => setDeleteConfirm(false)}
      />
    </form>
  );
}
