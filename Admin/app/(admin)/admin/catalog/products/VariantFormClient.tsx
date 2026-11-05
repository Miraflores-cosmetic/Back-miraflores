'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendFetch,
  adminBackendJson,
  readAdminApiError,
} from '@/lib/adminBackendFetch';
import type { AdminVariant, AdminVariantShade } from '@/lib/adminCatalogTypes';
import { revalidateCatalogStorefront } from '@/lib/revalidateCatalogStorefront';
import { isSampleVariantName } from '@/lib/sampleVariant';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import { VariantGalleryModal } from './VariantGalleryModal';
import vg from './VariantGalleryModal.module.css';
import pn from './productNew.module.css';

type ProductShell = {
  id: string;
  name: string;
  slug: string;
  images: { id: string; url: string; sortOrder: number; mediaType?: 'image' | 'video' }[];
};

type ShadeDraft = {
  key: string;
  id?: string;
  name: string;
  imageUrl: string | null;
};

function parseOptionalInt(raw: string, label: string, min = 0): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new Error(`${label}: целое число ≥ ${min}`);
  }
  return n;
}

function parseRequiredInt(raw: string, label: string, min = 0): number {
  const n = parseOptionalInt(raw, label, min);
  if (n == null) throw new Error(`${label}: обязательное поле`);
  return n;
}

function parseOptionalFloat(raw: string, label: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label}: число ≥ 0`);
  }
  return n;
}

/** Объём упаковки в литрах из мм: L×W×H / 1e6 */
function litersFromMm(lengthMm: string, widthMm: string, heightMm: string): string | null {
  const L = Number(lengthMm);
  const W = Number(widthMm);
  const H = Number(heightMm);
  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return null;
  return (Math.round((L * W * H) / 1e2) / 1e4).toString();
}

function shadesToDraft(shades: AdminVariantShade[]): ShadeDraft[] {
  return (shades ?? []).map((s) => ({
    key: s.id,
    id: s.id,
    name: s.name,
    imageUrl: s.imageUrl,
  }));
}

export function VariantFormClient({
  productId,
  variantId,
}: {
  productId: string;
  variantId?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const isEdit = Boolean(variantId);

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [productName, setProductName] = useState('');
  const [productSlug, setProductSlug] = useState('');
  const [productImages, setProductImages] = useState<ProductShell['images']>([]);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [nationalCatalogName, setNationalCatalogName] = useState('');
  const [volumeMl, setVolumeMl] = useState('');
  const [productImageIds, setProductImageIds] = useState<string[]>([]);
  const [galleryModalOpen, setGalleryModalOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [compareAt, setCompareAt] = useState('');
  const [orderMinQty, setOrderMinQty] = useState('1');
  const [orderMaxQty, setOrderMaxQty] = useState('');
  const [weightGrams, setWeightGrams] = useState('');
  const [lengthMm, setLengthMm] = useState('');
  const [widthMm, setWidthMm] = useState('');
  const [heightMm, setHeightMm] = useState('');
  const [packageVolume, setPackageVolume] = useState('');
  const [volumeManual, setVolumeManual] = useState(false);
  const [sku, setSku] = useState('');
  const [onecId, setOnecId] = useState('');
  const [stock, setStock] = useState('0');
  const [stockReserve, setStockReserve] = useState('0');
  const [active, setActive] = useState(true);
  const [isSample, setIsSample] = useState(false);
  const [shades, setShades] = useState<ShadeDraft[]>([]);
  const shadeFileRef = useRef<HTMLInputElement>(null);
  const [shadeUploadKey, setShadeUploadKey] = useState<string | null>(null);

  function markDirty() {
    setDirty(true);
  }

  const nameSuggestsSample = useMemo(
    () => isSampleVariantName(name),
    [name],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setLoadFailed(false);
      try {
        if (variantId) {
          const data = await adminBackendJson<{ variant: AdminVariant; product: ProductShell }>(
            `catalog/admin/variants/${variantId}`,
          );
          if (cancelled) return;
          if (data.product.id !== productId) {
            throw new Error('Вариант принадлежит другому товару');
          }
          setProductName(data.product.name);
          setProductSlug(data.product.slug);
          setProductImages(data.product.images ?? []);
          fillFromVariant(data.variant);
        } else {
          const p = await adminBackendJson<ProductShell>(
            `catalog/admin/products/${productId}/variant-form`,
          );
          if (cancelled) return;
          setProductName(p.name);
          setProductSlug(p.slug);
          setProductImages(p.images ?? []);
        }
        setDirty(false);
      } catch (e) {
        if (!cancelled) {
          setLoadFailed(true);
          setError(
            e instanceof AdminBackendRequestError || e instanceof Error
              ? e.message
              : 'Ошибка загрузки',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, variantId]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (volumeManual) return;
    const auto = litersFromMm(lengthMm, widthMm, heightMm);
    if (auto != null) setPackageVolume(auto);
  }, [lengthMm, widthMm, heightMm, volumeManual]);

  function fillFromVariant(v: AdminVariant) {
    setName(v.name);
    setSlug(v.slug);
    setNationalCatalogName(v.nationalCatalogName ?? '');
    setVolumeMl(v.volumeMl != null ? String(v.volumeMl) : '');
    setProductImageIds(v.productImageIds ?? []);
    setPrice(String(v.price));
    setCompareAt(v.compareAt != null ? String(v.compareAt) : '');
    setOrderMinQty(String(v.orderMinQty ?? 1));
    setOrderMaxQty(v.orderMaxQty != null ? String(v.orderMaxQty) : '');
    setWeightGrams(v.weightGrams != null ? String(v.weightGrams) : '');
    setLengthMm(v.lengthMm != null ? String(v.lengthMm) : '');
    setWidthMm(v.widthMm != null ? String(v.widthMm) : '');
    setHeightMm(v.heightMm != null ? String(v.heightMm) : '');
    setPackageVolume(v.packageVolume != null ? String(v.packageVolume) : '');
    setVolumeManual(v.packageVolume != null);
    setSku(v.sku);
    setOnecId(v.onecId ?? '');
    setStock(String(v.stock));
    setStockReserve(String(v.stockReserve ?? 0));
    setActive(v.active);
    setIsSample(Boolean(v.isSample));
    setShades(shadesToDraft(v.shades ?? []));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (!name.trim()) throw new Error('Укажите название');
      if (isEdit && !slug.trim()) {
        throw new Error('Slug нельзя очищать — укажите значение или верните прежний');
      }
      if (isEdit && !sku.trim()) {
        throw new Error('SKU нельзя очищать — укажите значение или верните прежний');
      }
      const priceVal = parseRequiredInt(price, 'Цена');
      const compareAtVal = compareAt.trim()
        ? parseRequiredInt(compareAt, 'Цена до скидки')
        : null;
      if (compareAtVal != null && compareAtVal <= priceVal) {
        throw new Error('Цена до скидки должна быть больше цены');
      }
      const minQty = parseOptionalInt(orderMinQty, 'Мин. кол-во', 1) ?? 1;
      const maxQty = parseOptionalInt(orderMaxQty, 'Макс. кол-во', 1);
      if (maxQty != null && maxQty < minQty) {
        throw new Error('Макс. кол-во не может быть меньше мин.');
      }
      const shadePayload = shades
        .map((s, i) => ({
          id: s.id,
          name: s.name.trim(),
          imageUrl: s.imageUrl,
          sortOrder: i,
        }))
        .filter((s) => s.name);
      const body = {
        name: name.trim(),
        slug: slug.trim() || undefined,
        nationalCatalogName: nationalCatalogName.trim() || null,
        volumeMl: volumeMl.trim() ? parseRequiredInt(volumeMl, 'Объём, мл') : null,
        productImageIds,
        price: priceVal,
        compareAt: compareAtVal,
        orderMinQty: minQty,
        orderMaxQty: maxQty,
        weightGrams: parseOptionalInt(weightGrams, 'Вес, г'),
        lengthMm: parseOptionalInt(lengthMm, 'Длина, мм'),
        widthMm: parseOptionalInt(widthMm, 'Ширина, мм'),
        heightMm: parseOptionalInt(heightMm, 'Высота, мм'),
        packageVolume: parseOptionalFloat(packageVolume, 'Объём упаковки'),
        sku: sku.trim() || undefined,
        onecId: onecId.trim() || null,
        stock: parseOptionalInt(stock, 'Остаток') ?? 0,
        stockReserve: parseOptionalInt(stockReserve, 'Резерв') ?? 0,
        active,
        isSample,
        shades: shadePayload,
      };

      if (!isEdit) {
        const created = await adminBackendJson<AdminVariant>(
          `catalog/admin/products/${productId}/variants`,
          { method: 'POST', body: JSON.stringify(body) },
        );
        await revalidateCatalogStorefront({ productSlug: productSlug || undefined });
        showToast('Вариант создан');
        router.replace(`/admin/catalog/products/${productId}/variants/${created.id}`);
        router.refresh();
        return;
      }

      const updated = await adminBackendJson<AdminVariant>(
        `catalog/admin/variants/${variantId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      fillFromVariant(updated);
      setDirty(false);
      await revalidateCatalogStorefront({ productSlug: productSlug || undefined });
      showToast('Сохранено');
      router.refresh();
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

  async function uploadShadeImage(key: string, file: File) {
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await adminBackendFetch('catalog/admin/upload-rich-media', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) throw new AdminBackendRequestError(await readAdminApiError(res), res.status);
      const { url } = (await res.json()) as { url: string };
      setShades((prev) =>
        prev.map((s) => (s.key === key ? { ...s, imageUrl: url } : s)),
      );
      markDirty();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить фото');
    } finally {
      setShadeUploadKey(null);
      if (shadeFileRef.current) shadeFileRef.current.value = '';
    }
  }

  if (loading) {
    return <p className={styles.muted}>Загрузка…</p>;
  }

  if (loadFailed) {
    return (
      <div className={styles.form}>
        <p className={styles.backRow}>
          <AdminCompactBtnLink href={`/admin/catalog/products/${productId}`} variant="outline">
            ← К товару
          </AdminCompactBtnLink>
        </p>
        <p className={styles.error} role="alert">
          {error ?? 'Не удалось загрузить вариант'}
        </p>
      </div>
    );
  }

  const titleText = name.trim() || (isEdit ? 'Вариант' : 'Новый вариант');
  const storefrontHref = productSlug.trim()
    ? `/product/${productSlug.trim()}${isEdit && variantId ? `?v=${encodeURIComponent(variantId)}` : ''}`
    : null;

  return (
    <form
      onSubmit={(e) => void onSave(e)}
      className={`${styles.form} ${styles.formWide}`}
      style={{ gap: 14 }}
    >
      <div className={pn.stickyToolbar}>
        <div className={pn.stickyToolbarMain}>
          <div className={pn.stickyToolbarNav}>
            <AdminCompactBtnLink href={`/admin/catalog/products/${productId}`} variant="outline">
              ← К товару{productName ? ` «${productName}»` : ''}
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
          <AdminCompactBtn type="submit" variant="accent" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </AdminCompactBtn>
        </div>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={pn.productFormGrid}>
        <div className={pn.productFormMain}>
          <AdminTextField
            label="Название"
            value={name}
            onChange={(e) => {
              markDirty();
              setName(e.target.value);
            }}
            required
          />
          <AdminTextField
            label="Slug"
            value={slug}
            onChange={(e) => {
              markDirty();
              setSlug(e.target.value);
            }}
            placeholder={isEdit ? undefined : 'пусто → авто'}
          />

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Галерея варианта</h2>
              <AdminCompactBtn
                type="button"
                variant="outline"
                onClick={() => setGalleryModalOpen(true)}
                disabled={productImages.length === 0}
              >
                Выбрать медиа
              </AdminCompactBtn>
            </div>
            <p className={styles.cardNote}>
              Кадры из галереи товара. Порядок — в модалке. Сохраняется по «Сохранить».
            </p>
            {productImages.length === 0 ? (
              <p className={styles.muted}>Сначала загрузите фото/видео на странице товара.</p>
            ) : productImageIds.length === 0 ? (
              <p className={styles.muted}>Ничего не выбрано</p>
            ) : (
              <ul className={vg.list}>
                {productImageIds.map((id, index) => {
                  const img = productImages.find((x) => x.id === id);
                  if (!img) return null;
                  const isVideo =
                    img.mediaType === 'video' || /\.(mp4|mov)(\?|$)/i.test(img.url);
                  return (
                    <li key={id} className={vg.row}>
                      <span className={vg.ord}>{index + 1}</span>
                      {isVideo ? (
                        <span className={vg.thumbVideo}>Видео</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className={vg.thumb} src={img.url} alt="" />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <VariantGalleryModal
            open={galleryModalOpen}
            onClose={() => setGalleryModalOpen(false)}
            onApply={(ids) => {
              markDirty();
              setProductImageIds(ids);
            }}
            productImages={productImages}
            selectedIds={productImageIds}
          />

          <div className={styles.fieldsRow2}>
            <AdminTextField
              label="Цена, ₽"
              value={price}
              inputMode="numeric"
              onChange={(e) => {
                markDirty();
                setPrice(e.target.value);
              }}
              required
            />
            <AdminTextField
              label="Цена до скидки, ₽"
              value={compareAt}
              inputMode="numeric"
              onChange={(e) => {
                markDirty();
                setCompareAt(e.target.value);
              }}
              placeholder="пусто = без скидки"
            />
          </div>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Оттенки</h2>
              <AdminCompactBtn
                type="button"
                variant="outline"
                onClick={() => {
                  markDirty();
                  setShades((prev) => [
                    ...prev,
                    { key: `new-${Date.now()}`, name: '', imageUrl: null },
                  ]);
                }}
              >
                Добавить
              </AdminCompactBtn>
            </div>
            <p className={styles.cardNote}>Имя + фото. Сохраняется вместе с формой.</p>
            {shades.length === 0 ? (
              <p className={styles.muted}>Оттенков нет</p>
            ) : (
              <ul className={vg.list}>
                {shades.map((s) => (
                  <li key={s.key} className={vg.row} style={{ alignItems: 'flex-start', gap: 10 }}>
                    {s.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={vg.thumb} src={s.imageUrl} alt="" />
                    ) : (
                      <span className={vg.thumbVideo}>нет фото</span>
                    )}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <AdminTextField
                        label="Название оттенка"
                        value={s.name}
                        onChange={(e) => {
                          markDirty();
                          const val = e.target.value;
                          setShades((prev) =>
                            prev.map((x) => (x.key === s.key ? { ...x, name: val } : x)),
                          );
                        }}
                      />
                      <div className={styles.fieldsRow}>
                        <AdminCompactBtn
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setShadeUploadKey(s.key);
                            shadeFileRef.current?.click();
                          }}
                        >
                          {s.imageUrl ? 'Заменить фото' : 'Загрузить фото'}
                        </AdminCompactBtn>
                        <AdminCompactBtn
                          type="button"
                          variant="outline"
                          onClick={() => {
                            markDirty();
                            setShades((prev) => prev.filter((x) => x.key !== s.key));
                          }}
                        >
                          Удалить
                        </AdminCompactBtn>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={shadeFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className={styles.visuallyHidden}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && shadeUploadKey) void uploadShadeImage(shadeUploadKey, file);
              }}
            />
          </section>

          <h2 className={styles.groupHeading}>Габариты</h2>
          <AdminTextField
            label="Вес, г"
            value={weightGrams}
            inputMode="numeric"
            onChange={(e) => {
              markDirty();
              setWeightGrams(e.target.value);
            }}
          />
          <div className={styles.fieldsRow4}>
            <AdminTextField
              label="Длина, мм"
              value={lengthMm}
              inputMode="numeric"
              onChange={(e) => {
                markDirty();
                setVolumeManual(false);
                setLengthMm(e.target.value);
              }}
            />
            <AdminTextField
              label="Ширина, мм"
              value={widthMm}
              inputMode="numeric"
              onChange={(e) => {
                markDirty();
                setVolumeManual(false);
                setWidthMm(e.target.value);
              }}
            />
            <AdminTextField
              label="Высота, мм"
              value={heightMm}
              inputMode="numeric"
              onChange={(e) => {
                markDirty();
                setVolumeManual(false);
                setHeightMm(e.target.value);
              }}
            />
            <AdminTextField
              label="Объём, л"
              value={packageVolume}
              inputMode="decimal"
              onChange={(e) => {
                markDirty();
                setVolumeManual(true);
                setPackageVolume(e.target.value);
              }}
              placeholder="авто из Д×Ш×В"
            />
          </div>

          <div className={styles.fieldsRow2}>
            <AdminTextField
              label="Остаток"
              value={stock}
              inputMode="numeric"
              onChange={(e) => {
                markDirty();
                setStock(e.target.value);
              }}
            />
            <AdminTextField
              label="Резерв"
              value={stockReserve}
              inputMode="numeric"
              onChange={(e) => {
                markDirty();
                setStockReserve(e.target.value);
              }}
            />
          </div>
        </div>

        <aside className={pn.productFormPlacement} aria-label="Параметры варианта">
          <p className={pn.placementHeading}>Параметры</p>

          <div className={pn.placementBlock}>
            <div className={styles.labelCheckboxRow}>
              <AdminCheckbox
                id="variant-active"
                className={styles.adminCheckboxForm}
                checked={active}
                onChange={(e) => {
                  markDirty();
                  setActive(e.target.checked);
                }}
                aria-label="Активен"
              />
              <label htmlFor="variant-active">Активен</label>
            </div>
            <div className={styles.checkboxRow}>
              <input
                id="variant-is-sample"
                type="checkbox"
                checked={isSample}
                onChange={(e) => {
                  markDirty();
                  setIsSample(e.target.checked);
                }}
                disabled={saving}
              />
              <label htmlFor="variant-is-sample">Пробник (лимиты покупки)</label>
            </div>
            {nameSuggestsSample && !isSample ? (
              <p className={pn.placementHint}>
                В названии есть «пробник» — включите флаг вручную, если это пробник для
                правил покупки (переименование само флаг не меняет).
              </p>
            ) : null}
          </div>

          <div className={pn.placementBlock}>
            <AdminTextField
              label="Объём, мл"
              value={volumeMl}
              inputMode="numeric"
              onChange={(e) => {
                markDirty();
                setVolumeMl(e.target.value);
              }}
            />
          </div>

          <div className={pn.placementBlock}>
            <AdminTextField
              label="SKU"
              value={sku}
              onChange={(e) => {
                markDirty();
                setSku(e.target.value);
              }}
              placeholder={isEdit ? undefined : 'пусто → авто'}
            />
          </div>

          <div className={pn.placementBlock}>
            <AdminTextField
              label="1С UUID (onecId)"
              value={onecId}
              onChange={(e) => {
                markDirty();
                setOnecId(e.target.value);
              }}
              placeholder="UUID из выгрузки 1С"
            />
          </div>

          <div className={pn.placementBlock}>
            <AdminTextField
              label="Название из Нац. каталога"
              value={nationalCatalogName}
              onChange={(e) => {
                markDirty();
                setNationalCatalogName(e.target.value);
              }}
            />
          </div>

          <div className={pn.placementBlock}>
            <h3 className={`${styles.groupHeading} ${pn.placementGroupHeading}`}>Лимиты заказа</h3>
            <div className={pn.additionalCatsWrap}>
              <AdminTextField
                label="Мин. кол-во"
                value={orderMinQty}
                inputMode="numeric"
                onChange={(e) => {
                  markDirty();
                  setOrderMinQty(e.target.value);
                }}
              />
              <AdminTextField
                label="Макс. кол-во"
                value={orderMaxQty}
                inputMode="numeric"
                onChange={(e) => {
                  markDirty();
                  setOrderMaxQty(e.target.value);
                }}
                placeholder="без ограничения"
              />
            </div>
          </div>
        </aside>
      </div>
    </form>
  );
}
