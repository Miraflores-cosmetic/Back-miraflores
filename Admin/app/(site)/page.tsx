import { Hero } from '@/sections/home/Hero/Hero';
import { HomePromo } from '@/sections/home/HomePromo/HomePromo';
import { Recommendations } from '@/sections/home/Recommendations/Recommendations';
import { FeaturedCollections } from '@/sections/home/FeaturedCollections/FeaturedCollections';
import { Articles } from '@/sections/home/Articles/Articles';
import { Faq } from '@/sections/home/Faq/Faq';
import { FaqJsonLd } from '@/components/FaqJsonLd/FaqJsonLd';
import {
  fetchPublicCollections,
  fetchPublicProducts,
  toProductCardProps,
  type PublicCollectionCard,
} from '@/lib/publicCatalog';
import {
  fetchBlogCategoriesPublic,
  fetchBlogPostsPublic,
} from '@/lib/blogPublicServer';
import { fetchPublicFaq } from '@/lib/faqPublicServer';
import { fetchPublicHero } from '@/lib/heroPublicServer';
import { fetchPublicHomePromo } from '@/lib/homePromoPublicServer';
import { fetchPublicHomepageSets } from '@/lib/homepageSetsPublicServer';
import { Sets } from '@/sections/home/Sets/Sets';

/** Featured-блок после секции «все товары». Остальные — в общем потоке коллекций. */
const FEATURED_AFTER_PRODUCTS = new Set(['novaya-kollektsiya']);

function FeaturedBlock({ c }: { c: PublicCollectionCard }) {
  return (
    <FeaturedCollections
      key={c.slug}
      items={[
        {
          slug: c.slug,
          name: c.name,
          description: c.shortDescription?.trim() || '',
          productPreview: c.productPreviewUrl,
          lifestyleImage: c.coverImageUrl || c.productPreviewUrl,
        },
      ]}
    />
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const [products, collections, blogPosts, blogCategories, faq, hero, homepageSets, homePromo] =
    await Promise.all([
    fetchPublicProducts({ limit: 12 }),
    fetchPublicCollections(),
    fetchBlogPostsPublic({ limit: 3 }),
    fetchBlogCategoriesPublic(),
    fetchPublicFaq(),
    fetchPublicHero(),
    fetchPublicHomepageSets(),
    fetchPublicHomePromo(),
  ]);

  const productCards = products.map(toProductCardProps);
  const posts = blogPosts.items;
  const featured = posts[0];
  const listItems = posts.slice(1, 3);
  const faqItems = faq.items;
  const faqOpenId =
    typeof searchParams?.q === 'string' && searchParams.q.trim()
      ? searchParams.q.trim()
      : null;

  const mainCollections = collections.filter(
    (c) => !(c.featuredLayout && FEATURED_AFTER_PRODUCTS.has(c.slug)),
  );
  const featuredAfterProducts = collections.filter(
    (c) => c.featuredLayout && FEATURED_AFTER_PRODUCTS.has(c.slug),
  );
  const firstHomepageSet = homepageSets.items[0] ?? null;

  return (
    <main>
      <Hero slides={hero.items} />
      {homePromo.items.length > 0 ? (
        <HomePromo
          titleLeft={homePromo.titleLeft}
          titleRight={homePromo.titleRight}
          items={homePromo.items}
        />
      ) : null}
      {firstHomepageSet ? (
        <Sets
          setImageUrl={firstHomepageSet.imageUrl}
          product={firstHomepageSet.product}
        />
      ) : null}
      {mainCollections.map((c) => {
        if (c.featuredLayout) {
          return <FeaturedBlock key={c.slug} c={c} />;
        }
        const items = (c.products ?? []).map(toProductCardProps);
        if (!items.length) return null;
        return (
          <Recommendations
            key={c.slug}
            title={c.name}
            items={items}
            moreHref={`/catalog?collection=${encodeURIComponent(c.slug)}`}
            moreLabel="Все →"
          />
        );
      })}
      {featured ? (
        <Articles
          featured={{
            slug: featured.slug,
            title: featured.title,
            imageUrl: featured.coverUrl,
          }}
          items={listItems.map((p) => ({
            slug: p.slug,
            title: p.title,
            imageUrl: p.coverUrl,
          }))}
          categories={blogCategories.map((c) => ({ slug: c.slug, label: c.name }))}
          sideImageUrl="/images/home/Articles-side.jpg"
        />
      ) : null}
      {productCards.length > 0 ? (
        <Recommendations items={productCards} moreHref="/catalog" moreLabel="Все →" />
      ) : null}
      {featuredAfterProducts.map((c) => (
        <FeaturedBlock key={c.slug} c={c} />
      ))}
      <FaqJsonLd items={faqItems} />
      <Faq items={faqItems} initialOpenId={faqOpenId} />
    </main>
  );
}
