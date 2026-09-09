'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ProductCard } from '@/components/ProductCard/ProductCard';
import { useBuyerAuth } from '@/lib/BuyerAuthProvider';
import {
  fetchPublicProductsPageClient,
  PUBLIC_CATALOG_PAGE_SIZE,
  toProductCardProps,
  type PublicCatalogTag,
  type PublicCategoryNode,
  type PublicProductCard,
} from '@/lib/publicCatalog';
import { CatalogBubbles } from './CatalogBubbles';
import { CatalogFilters } from './CatalogFilters';
import { CatalogPager } from './CatalogPager';
import { catalogHref } from './catalogHref';
import { findSubcategoryChainInRoot } from './catalogLoad';
import styles from './CatalogPage.module.css';

export type CatalogNotice =
  | 'api'
  | 'unknown_cat'
  | 'unknown_sub'
  | 'unknown_tag'
  | 'unknown_collection';

type InitialState = {
  items: PublicProductCard[];
  total: number;
  page: number;
  limit: number;
  cat: string;
  sub: string;
  tag: string;
  collection: string;
  collectionName: string | null;
  sale: boolean;
  priceMin: number | null;
  priceMax: number | null;
  q: string;
  title: string;
};

function productsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'продукт';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'продукта';
  return 'продуктов';
}

export function CatalogClient({
  categories,
  tags,
  initial,
  notice = null,
}: {
  categories: PublicCategoryNode[];
  tags: PublicCatalogTag[];
  initial: InitialState;
  notice?: CatalogNotice | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const { ready: buyerReady, authenticated: buyerAuthed } = useBuyerAuth();
  const [items, setItems] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [listPage, setListPage] = useState(initial.page);

  const cat = initial.cat;
  const sub = initial.sub;
  const tag = searchParams.get('tag') ?? initial.tag;
  const collection = searchParams.get('collection') ?? initial.collection;
  const q = searchParams.get('q')?.trim() || initial.q || '';
  const sale = (searchParams.get('sale') ?? (initial.sale ? '1' : '')) === '1';
  const priceMinRaw = searchParams.get('priceMin');
  const priceMaxRaw = searchParams.get('priceMax');
  const priceMin = priceMinRaw != null ? Number(priceMinRaw) : initial.priceMin;
  const priceMax = priceMaxRaw != null ? Number(priceMaxRaw) : initial.priceMax;

  const path = useMemo(() => ({ cat, sub }), [cat, sub]);

  const selectedRoot = useMemo(
    () => categories.find((c) => c.slug === cat) ?? null,
    [categories, cat],
  );
  const bubbles: PublicCategoryNode[] = selectedRoot
    ? selectedRoot.children ?? []
    : categories;

  const title = initial.title || (q ? `Поиск: ${q}` : 'Каталог');
  const subChain = selectedRoot && sub
    ? findSubcategoryChainInRoot(selectedRoot, sub)
    : [];

  const pageSize = initial.limit || PUBLIC_CATALOG_PAGE_SIZE;

  useEffect(() => {
    setItems(initial.items);
    setTotal(initial.total);
    setListPage(initial.page);
  }, [initial]);

  useEffect(() => {
    if (!buyerReady || !buyerAuthed || notice) return;
    const page = Math.max(1, Number(searchParams.get('page')) || initial.page || 1);
    const sale = (searchParams.get('sale') ?? (initial.sale ? '1' : '')) === '1';
    const priceMinRaw = searchParams.get('priceMin');
    const priceMaxRaw = searchParams.get('priceMax');
    const priceMin = priceMinRaw != null ? Number(priceMinRaw) : initial.priceMin;
    const priceMax = priceMaxRaw != null ? Number(priceMaxRaw) : initial.priceMax;
    const tag = searchParams.get('tag') ?? initial.tag;
    const collection = searchParams.get('collection') ?? initial.collection;
    const q = searchParams.get('q')?.trim() || initial.q || '';
    if (q) return;

    void (async () => {
      const data = await fetchPublicProductsPageClient({
        page,
        limit: pageSize,
        category: initial.sub || initial.cat || undefined,
        tag: tag || undefined,
        collection: collection || undefined,
        sort: 'newest',
        sale,
        priceMin: Number.isFinite(priceMin) ? priceMin! : undefined,
        priceMax: Number.isFinite(priceMax) ? priceMax! : undefined,
      });
      if (!data) return;
      setItems(data.items);
      setTotal(data.total);
      setListPage(data.page);
    })();
  }, [
    buyerReady,
    buyerAuthed,
    notice,
    searchParams,
    initial.cat,
    initial.sub,
    initial.tag,
    initial.collection,
    initial.sale,
    initial.priceMin,
    initial.priceMax,
    initial.q,
    initial.page,
    pageSize,
  ]);

  const patchParams = useCallback(
    (patch: Record<string, string | null>, opts?: { scroll?: boolean }) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete('cat');
      sp.delete('sub');
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'cat' || k === 'sub') continue;
        if (v == null || v === '') sp.delete(k);
        else sp.set(k, v);
      }
      if (!('page' in patch)) sp.delete('page');
      const qs = sp.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, {
          scroll: opts?.scroll ?? false,
        });
      });
    },
    [pathname, router, searchParams],
  );

  return (
    <main className={styles.page}>
      <section id="hero-section" className={styles.hero} aria-label="Каталог">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.heroImg}
          src="/images/home/catalog-cover.webp"
          alt=""
        />
        <div className={`padding-global ${styles.heroContent}`}>
          <nav className={styles.crumbs} aria-label="Навигация">
            <Link href="/">Главная</Link>
            <span aria-hidden> / </span>
            {collection || q ? (
              <>
                <Link href="/catalog" className={styles.crumbBtn}>
                  Каталог
                </Link>
                <span aria-hidden> / </span>
                <span>{title}</span>
              </>
            ) : selectedRoot ? (
              <>
                <Link href="/catalog" className={styles.crumbBtn}>
                  Каталог
                </Link>
                <span aria-hidden> / </span>
                {subChain.length === 0 ? (
                  <span>{selectedRoot.name}</span>
                ) : (
                  <>
                    <Link
                      href={catalogHref(searchParams, { sub: null }, path)}
                      className={styles.crumbBtn}
                    >
                      {selectedRoot.name}
                    </Link>
                    {subChain.map((node, i) => {
                      const isLast = i === subChain.length - 1;
                      return (
                        <span key={node.slug}>
                          <span aria-hidden> / </span>
                          {isLast ? (
                            <span>{node.name}</span>
                          ) : (
                            <Link
                              href={catalogHref(
                                searchParams,
                                { sub: node.slug },
                                { cat: selectedRoot.slug },
                              )}
                              className={styles.crumbBtn}
                            >
                              {node.name}
                            </Link>
                          )}
                        </span>
                      );
                    })}
                  </>
                )}
              </>
            ) : tag ? (
              <>
                <Link href="/catalog" className={styles.crumbBtn}>
                  Каталог
                </Link>
                <span aria-hidden> / </span>
                <span>{title}</span>
              </>
            ) : (
              <span>Каталог</span>
            )}
          </nav>
          <h1 className={styles.heroTitle}>{title}</h1>
        </div>
      </section>

      <div className={`padding-global ${styles.body}`}>
        {!q ? (
          <CatalogBubbles
            bubbles={bubbles}
            selectedRoot={selectedRoot}
            cat={cat}
            sub={sub}
            searchParams={searchParams}
            path={path}
          />
        ) : null}

        <div className={styles.toolbar}>
          <p className={styles.count} aria-live="polite">
            {notice
              ? null
              : `${total.toLocaleString('ru-RU')} ${productsWord(total)}`}
          </p>
        </div>

        {!q ? (
          <CatalogFilters
            tags={tags}
            tag={tag}
            sale={sale}
            priceMin={priceMin}
            priceMax={priceMax}
            showClearCategory={Boolean(selectedRoot || collection)}
            clearCategoryLabel={
              collection ? 'сбросить коллекцию' : 'сбросить категорию'
            }
            searchParams={searchParams}
            path={path}
            patchParams={patchParams}
          />
        ) : null}

        <div className={styles.grid} data-pending={pending || undefined}>
          {notice === 'api' ? (
            <div className={styles.empty} role="alert">
              <p className={styles.emptyText}>
                Не удалось загрузить каталог. Обновите страницу или попробуйте позже.
              </p>
            </div>
          ) : notice === 'unknown_cat' ||
            notice === 'unknown_sub' ||
            notice === 'unknown_tag' ||
            notice === 'unknown_collection' ? (
            <div className={styles.empty} role="status">
              <p className={styles.emptyText}>
                {notice === 'unknown_cat'
                  ? 'Категория не найдена.'
                  : notice === 'unknown_sub'
                    ? 'Подкатегория не найдена.'
                    : notice === 'unknown_tag'
                      ? 'Область применения не найдена.'
                      : 'Коллекция не найдена.'}
              </p>
              <Link href="/catalog" className={styles.emptyAction}>
                Сбросить фильтры
              </Link>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.empty} role="status">
              <p className={styles.emptyText}>Ничего не найдено</p>
              <Link
                href={catalogHref(
                  searchParams,
                  {
                    cat: null,
                    sub: null,
                    tag: null,
                    collection: null,
                    sale: null,
                    priceMin: null,
                    priceMax: null,
                    q: null,
                  },
                  path,
                )}
                className={styles.emptyAction}
              >
                Сбросить фильтры
              </Link>
            </div>
          ) : (
            items.map((p) => (
              <ProductCard key={p.id} {...toProductCardProps(p)} />
            ))
          )}
        </div>

        {!notice ? (
          <CatalogPager
            page={listPage}
            total={total}
            pageSize={pageSize}
            pending={pending}
            onPrev={() =>
              patchParams({ page: String(Math.max(1, listPage - 1)) }, { scroll: true })
            }
            onNext={() =>
              patchParams({ page: String(listPage + 1) }, { scroll: true })
            }
          />
        ) : null}
      </div>
    </main>
  );
}
