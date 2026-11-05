import type { PrismaClient } from '@prisma/client';
import { DEFAULT_SAMPLE_RULES_ARTICLE_SLUG } from './sample-purchase.constants';

type BlogReader = Pick<PrismaClient, 'blogPost'>;

export async function publishedBlogPostSlugExists(
  prisma: BlogReader,
  slug: string,
): Promise<boolean> {
  const s = slug.trim();
  if (!s) return false;
  const row = await prisma.blogPost.findUnique({
    where: { slug: s },
    select: { isPublished: true },
  });
  return Boolean(row?.isPublished);
}

/** Slug для ссылки на правила: явный в настройках или дефолт, если статья опубликована. */
export async function resolveSampleRulesArticleSlug(
  prisma: BlogReader,
  configuredSlug: string | null | undefined,
): Promise<string | null> {
  const explicit = configuredSlug?.trim();
  if (explicit) {
    return (await publishedBlogPostSlugExists(prisma, explicit))
      ? explicit
      : null;
  }
  return (await publishedBlogPostSlugExists(
    prisma,
    DEFAULT_SAMPLE_RULES_ARTICLE_SLUG,
  ))
    ? DEFAULT_SAMPLE_RULES_ARTICLE_SLUG
    : null;
}
