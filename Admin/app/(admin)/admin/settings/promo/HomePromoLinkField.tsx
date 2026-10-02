'use client';

import { useEffect, useState } from 'react';
import {
  DiscountCategoryPickerModal,
  DiscountProductPickerModal,
} from '@/app/(admin)/admin/discounts/DiscountScopePickerModal';
import { BlogPostPickerModal } from '@/app/(admin)/admin/settings/promo/BlogPostPickerModal';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { useToast } from '@/components/Toast/ToastProvider';
import { adminBackendJson } from '@/lib/adminBackendFetch';
import type { AdminCategory, AdminProduct } from '@/lib/adminCatalogTypes';
import { HOME_PROMO_PAGE_OPTIONS } from '@/lib/homePromoPageOptions';
import {
  articleStorefrontHref,
  categoryStorefrontHref,
  inferStorefrontLinkKind,
  productStorefrontHref,
  type StorefrontLinkKind,
} from '@/lib/storefrontHref';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import styles from './HomePromoAdmin.module.css';

const KIND_OPTIONS: { value: StorefrontLinkKind; label: string }[] = [
  { value: 'page', label: 'Страница сайта' },
  { value: 'category', label: 'Категория' },
  { value: 'product', label: 'Товар' },
  { value: 'article', label: 'Статья' },
  { value: 'custom', label: 'Свой путь' },
];

const HREF_OK = /^\/[a-zA-Z0-9/_-]*$/;

function defaultHrefForKind(kind: StorefrontLinkKind): string {
  if (kind === 'page') return HOME_PROMO_PAGE_OPTIONS[0]?.href ?? '/catalog';
  if (kind === 'custom') return '/';
  return '';
}

export function HomePromoLinkField({
  href,
  disabled,
  onChange,
}: {
  href: string;
  disabled?: boolean;
  onChange: (href: string) => void;
}) {
  const { showToast } = useToast();
  const [kind, setKind] = useState<StorefrontLinkKind>(() => inferStorefrontLinkKind(href));
  const [picker, setPicker] = useState<'category' | 'product' | 'article' | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!href.trim()) return;
    setKind(inferStorefrontLinkKind(href));
  }, [href]);

  const knownPage = HOME_PROMO_PAGE_OPTIONS.some((o) => o.href === href);
  const hrefInvalid = Boolean(href) && !HREF_OK.test(href);
  const busy = disabled || resolving;

  async function applyCategory(ids: string[]) {
    const id = ids[0];
    if (!id) return;
    setResolving(true);
    try {
      const cats = await adminBackendJson<AdminCategory[]>('catalog/admin/categories');
      const cat = cats.find((c) => c.id === id);
      if (!cat?.slug) {
        showToast('Не удалось получить путь категории');
        return;
      }
      onChange(categoryStorefrontHref(cat));
    } catch {
      showToast('Не удалось загрузить категорию');
    } finally {
      setResolving(false);
      setPicker(null);
    }
  }

  async function applyProduct(ids: string[]) {
    const id = ids[0];
    if (!id) return;
    setResolving(true);
    try {
      const p = await adminBackendJson<Pick<AdminProduct, 'slug' | 'name'>>(
        `catalog/admin/products/${id}`,
      );
      if (!p.slug?.trim()) {
        showToast('У товара нет slug');
        return;
      }
      onChange(productStorefrontHref(p.slug));
    } catch {
      showToast('Не удалось загрузить товар');
    } finally {
      setResolving(false);
      setPicker(null);
    }
  }

  return (
    <>
      <label className={catalogStyles.field}>
        <span className={catalogStyles.label}>Ссылка</span>
        <select
          className={catalogStyles.input}
          value={kind}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.value as StorefrontLinkKind;
            setKind(next);
            if (next === 'page' || next === 'custom') {
              onChange(defaultHrefForKind(next));
            } else if (inferStorefrontLinkKind(href) !== next) {
              onChange('');
            }
          }}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {kind === 'page' ? (
        <label className={catalogStyles.field}>
          <span className={catalogStyles.label}>Страница сайта</span>
          <select
            className={catalogStyles.input}
            value={knownPage ? href : ''}
            disabled={busy}
            onChange={(e) => onChange(e.target.value)}
          >
            {!knownPage ? <option value="">Выберите…</option> : null}
            {HOME_PROMO_PAGE_OPTIONS.map((o) => (
              <option key={o.href} value={o.href}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {kind === 'category' || kind === 'product' || kind === 'article' ? (
        <div className={styles.linkPickRow}>
          <p className={styles.linkPath}>
            {href ? href : 'Не выбрано'}
          </p>
          <AdminCompactBtn
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setPicker(kind)}
          >
            {href
              ? kind === 'category'
                ? 'Сменить категорию'
                : kind === 'product'
                  ? 'Сменить товар'
                  : 'Сменить статью'
              : kind === 'category'
                ? 'Выбрать категорию'
                : kind === 'product'
                  ? 'Выбрать товар'
                  : 'Выбрать статью'}
          </AdminCompactBtn>
        </div>
      ) : null}

      {kind === 'custom' ? (
        <label className={catalogStyles.field}>
          <span className={catalogStyles.label}>Путь</span>
          <input
            className={catalogStyles.input}
            value={href}
            disabled={busy}
            placeholder="/catalog/…"
            onChange={(e) => onChange(e.target.value)}
          />
          {hrefInvalid ? (
            <span className={styles.fieldError}>
              Только относительный путь, например /catalog или /product/slug
            </span>
          ) : null}
        </label>
      ) : null}

      {kind !== 'custom' && href ? (
        <p className={styles.linkHint}>Путь на сайте: {href}</p>
      ) : null}

      {kind !== 'custom' && !href ? (
        <p className={styles.fieldError}>Выберите ссылку</p>
      ) : null}

      <DiscountCategoryPickerModal
        open={picker === 'category'}
        single
        selectedIds={[]}
        onClose={() => setPicker(null)}
        onApply={(ids) => {
          void applyCategory(ids);
        }}
      />
      <DiscountProductPickerModal
        open={picker === 'product'}
        single
        selectedIds={[]}
        selectedLabels={{}}
        onClose={() => setPicker(null)}
        onApply={(ids) => {
          void applyProduct(ids);
        }}
      />
      <BlogPostPickerModal
        open={picker === 'article'}
        onClose={() => setPicker(null)}
        onPick={(post) => {
          onChange(articleStorefrontHref(post.slug));
          setPicker(null);
        }}
      />
    </>
  );
}

export function isPromoHrefComplete(href: string): boolean {
  const t = href.trim();
  return Boolean(t) && HREF_OK.test(t);
}
