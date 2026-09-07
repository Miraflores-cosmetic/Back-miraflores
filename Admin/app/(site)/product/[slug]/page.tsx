import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Recommendations } from '@/sections/home/Recommendations/Recommendations';
import {
  fetchPublicProduct,
  fetchPublicSetSiblings,
  stripHtml,
  toProductCardProps,
} from '@/lib/publicCatalog';
import { ProductInteractive } from './ProductInteractive';
import styles from './ProductPageLayout.module.css';

/**
 * Admin `(site)` PDP — не покупательская витрина.
 * Рейтинг / отзывы / `/reviews` — только Vite Front (см. Admin/README.md).
 */

type Props = {
  params: { slug: string };
  searchParams?: { v?: string; shade?: string };
};

function siteOrigin(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    '';
  return fromEnv.replace(/\/+$/, '') || 'http://localhost:3000';
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await fetchPublicProduct(params.slug);
  if (!product) return { title: 'Товар — Jcos' };
  const description =
    product.shortDescription ||
    stripHtml(product.descriptionHtml).slice(0, 160) ||
    undefined;
  const ogImage =
    product.images.find((i) => i.mediaType !== 'video')?.url ||
    product.images[0]?.url ||
    undefined;
  const url = `${siteOrigin()}/product/${product.slug}`;

  return {
    title: `${product.name} — Jcos`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      title: product.name,
      description,
      images: ogImage ? [{ url: ogImage, alt: product.name }] : undefined,
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title: product.name,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const product = await fetchPublicProduct(params.slug);
  if (!product) notFound();

  const setItems = await fetchPublicSetSiblings(params.slug);
  const variantQuery = searchParams?.v?.trim();
  const shadeQuery = searchParams?.shade?.trim();
  const initialVariantId =
    product.variants.find((v) => v.id === variantQuery || v.slug === variantQuery)?.id ??
    product.variants[0]?.id;
  const initialVariant =
    product.variants.find((v) => v.id === initialVariantId) ?? product.variants[0];
  const initialShadeId =
    initialVariant?.shades.find((s) => s.id === shadeQuery)?.id ??
    initialVariant?.shades[0]?.id;

  const crumbs: Array<{ label: string; href: string; current?: boolean }> = [
    { label: 'Главная', href: '/' },
    { label: 'Каталог', href: '/catalog' },
  ];
  let categoryBack: { label: string; href: string } = {
    label: 'Каталог',
    href: '/catalog',
  };
  if (product.category.parent) {
    crumbs.push({
      label: product.category.parent.name,
      href: `/catalog/${encodeURIComponent(product.category.parent.slug)}`,
    });
    const categoryHref = `/catalog/${encodeURIComponent(product.category.parent.slug)}/${encodeURIComponent(product.category.slug)}`;
    crumbs.push({
      label: product.category.name,
      href: categoryHref,
    });
    categoryBack = { label: product.category.name, href: categoryHref };
  } else {
    const categoryHref = `/catalog/${encodeURIComponent(product.category.slug)}`;
    crumbs.push({
      label: product.category.name,
      href: categoryHref,
    });
    categoryBack = { label: product.category.name, href: categoryHref };
  }
  crumbs.push({
    label: product.name,
    href: `/product/${product.slug}`,
    current: true,
  });

  const origin = siteOrigin();
  const pageUrl = `${origin}/product/${product.slug}`;
  const imageUrls = product.images
    .filter((i) => i.mediaType !== 'video')
    .map((i) => i.url);
  const prices = product.variants.map((v) => v.price).filter((n) => n > 0);
  const low = prices.length ? Math.min(...prices) : undefined;
  const high = prices.length ? Math.max(...prices) : undefined;
  const inStock = product.variants.some((v) => v.available > 0);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description:
      product.shortDescription ||
      stripHtml(product.descriptionHtml).slice(0, 300) ||
      undefined,
    image: imageUrls.length ? imageUrls : undefined,
    sku: product.variants[0]?.sku || undefined,
    brand: { '@type': 'Brand', name: 'Jcos' },
    url: pageUrl,
    offers:
      low != null
        ? {
            '@type': high != null && high > low ? 'AggregateOffer' : 'Offer',
            url: pageUrl,
            priceCurrency: 'RUB',
            ...(high != null && high > low
              ? { lowPrice: low, highPrice: high, offerCount: product.variants.length }
              : { price: low }),
            availability: inStock
              ? 'https://schema.org/InStock'
              : 'https://schema.org/OutOfStock',
          }
        : undefined,
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <section className={styles.productSection}>
        <div className="padding-global">
          <div className={styles.productPageFlow}>
            <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
              {crumbs.map((item, i) => (
                <Fragment key={`${item.label}-${i}`}>
                  {i > 0 ? <span className={styles.breadcrumbsSep}>/</span> : null}
                  {item.current ? (
                    <span className={styles.breadcrumbsCurrent}>{item.label}</span>
                  ) : (
                    <Link href={item.href} className={styles.breadcrumbsLink}>
                      {item.label}
                    </Link>
                  )}
                </Fragment>
              ))}
            </nav>

            <ProductInteractive
              product={product}
              categoryBack={categoryBack}
              initialVariantId={initialVariantId}
              initialShadeId={initialShadeId}
            />
          </div>
        </div>
      </section>

      {setItems.length > 0 ? (
        <Recommendations
          id="product-recommendations"
          title="Наборы"
          items={setItems.map(toProductCardProps)}
        />
      ) : null}
    </main>
  );
}
