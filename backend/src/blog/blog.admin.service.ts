import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LocalStorageService } from '../storage/local-storage.service';
import { slugify } from '../catalog/slug.util';
import {
  normalizeCanonicalPath,
  trimOrNull,
} from '../catalog/catalog-admin.helpers';
import { htmlToSearchText } from '../common/html-to-search-text.util';
import {
  extractMediaUrlsFromRichHtml,
  sanitizeBlogBodyForWrite,
  sanitizeBlogExcerptHtml,
} from './blog-html.util';
import {
  BulkIdsDto,
  CreateBlogCategoryAdminDto,
  CreateBlogPostAdminDto,
  ReorderBlogPostsDto,
  UpdateBlogCategoryAdminDto,
  UpdateBlogPostAdminDto,
} from './dto/blog-admin.dto';

@Injectable()
export class BlogAdminService {
  private readonly logger = new Logger(BlogAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
  ) {}

  async listCategoriesAdmin() {
    const rows = await this.prisma.blogCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { posts: true } } },
    });
    return rows.map(({ _count, ...r }) => ({
      ...r,
      postCount: _count.posts,
    }));
  }

  async createCategory(dto: CreateBlogCategoryAdminDto) {
    const base = dto.slug?.trim() || slugify(dto.name);
    const slug = await this.ensureUniqueCategorySlug(base);
    const maxSort = await this.prisma.blogCategory.aggregate({ _max: { sortOrder: true } });
    const sortOrder = dto.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1;
    return this.prisma.blogCategory.create({
      data: { name: dto.name.trim(), slug, sortOrder },
    });
  }

  async updateCategory(id: string, dto: UpdateBlogCategoryAdminDto) {
    const row = await this.prisma.blogCategory.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Категория не найдена');
    const data: Prisma.BlogCategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.slug?.trim()) {
      data.slug = await this.ensureUniqueCategorySlug(dto.slug.trim(), id);
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.prisma.blogCategory.update({ where: { id }, data });
  }

  async deleteCategory(id: string) {
    const row = await this.prisma.blogCategory.findUnique({
      where: { id },
      include: { _count: { select: { posts: true } } },
    });
    if (!row) throw new NotFoundException('Категория не найдена');
    if (row._count.posts > 0) {
      throw new BadRequestException('Нельзя удалить категорию со статьями');
    }
    await this.prisma.blogCategory.delete({ where: { id } });
    return { ok: true };
  }

  async listPostsAdmin(params: {
    q?: string;
    categoryId?: string;
    published?: 'all' | 'published' | 'draft';
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    /** Согласовано с FE `PAGE_LIMIT=20`; max 100 — страница, не «весь каталог». */
    const limit = Math.min(Math.max(1, params.limit ?? 20), 100);
    const q = params.q?.trim();
    const and: Prisma.BlogPostWhereInput[] = [];
    if (params.categoryId?.trim()) {
      and.push({ categoryId: params.categoryId.trim() });
    }
    if (params.published === 'published') and.push({ isPublished: true });
    if (params.published === 'draft') and.push({ isPublished: false });
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { excerpt: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.BlogPostWhereInput = and.length ? { AND: and } : {};
    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { category: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getPostAdmin(id: string) {
    const row = await this.prisma.blogPost.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!row) throw new NotFoundException('Статья не найдена');
    return row;
  }

  async createPost(dto: CreateBlogPostAdminDto, authorId?: string | null) {
    const baseSlug = dto.slug?.trim() || slugify(dto.title);
    const slug = await this.ensureUniquePostSlug(baseSlug);
    const categoryId = this.normalizeCategoryId(dto.categoryId);
    if (categoryId) {
      const c = await this.prisma.blogCategory.findUnique({ where: { id: categoryId } });
      if (!c) throw new BadRequestException('Категория не найдена');
    }
    const isPublished = dto.isPublished ?? false;
    let publishedAt = this.parsePublishedAt(dto.publishedAt);
    if (isPublished && !publishedAt) publishedAt = new Date();
    const body = sanitizeBlogBodyForWrite(dto.body);
    const excerpt = sanitizeBlogExcerptHtml(dto.excerpt);
    this.assertUploadUrlAllowed(dto.coverUrl);
    this.assertBodyMediaUrlsAllowed(body);
    const maxSort = await this.prisma.blogPost.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
    return this.prisma.blogPost.create({
      data: {
        title: dto.title.trim(),
        slug,
        categoryId,
        excerpt,
        body,
        bodySearchText: htmlToSearchText(body),
        isPublished,
        publishedAt,
        coverUrl: dto.coverUrl?.trim() || null,
        metaTitle: trimOrNull(dto.metaTitle),
        metaDescription: trimOrNull(dto.metaDescription),
        ogImageUrl: trimOrNull(dto.ogImageUrl),
        canonicalPath: normalizeCanonicalPath(dto.canonicalPath),
        seoNoIndex: dto.seoNoIndex ?? false,
        authorId: authorId ?? null,
        sortOrder,
      },
      include: { category: true },
    });
  }

  async updatePost(id: string, dto: UpdateBlogPostAdminDto) {
    const row = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Статья не найдена');
    let slug = row.slug;
    if (dto.slug?.trim()) {
      slug = await this.ensureUniquePostSlug(dto.slug.trim(), id);
    }
    let categoryId: string | null | undefined;
    if (dto.categoryId !== undefined) {
      categoryId = this.normalizeCategoryId(dto.categoryId);
      if (categoryId) {
        const c = await this.prisma.blogCategory.findUnique({ where: { id: categoryId } });
        if (!c) throw new BadRequestException('Категория не найдена');
      }
    }
    let publishedAt: Date | null | undefined;
    if (dto.publishedAt !== undefined) {
      if (
        dto.publishedAt === null ||
        (typeof dto.publishedAt === 'string' && !dto.publishedAt.trim())
      ) {
        publishedAt = null;
      } else {
        publishedAt = this.parsePublishedAt(String(dto.publishedAt));
      }
    }
    const nextPublished =
      dto.isPublished !== undefined ? dto.isPublished : row.isPublished;
    if (nextPublished) {
      const effective =
        publishedAt !== undefined ? publishedAt : row.publishedAt;
      if (!effective) {
        publishedAt = new Date();
      }
    }

    const resolvedNextCover =
      dto.coverUrl !== undefined
        ? dto.coverUrl?.trim()
          ? dto.coverUrl.trim()
          : null
        : row.coverUrl;
    const resolvedNextBody =
      dto.body != null ? sanitizeBlogBodyForWrite(dto.body) : row.body;
    const resolvedNextExcerpt =
      dto.excerpt !== undefined
        ? sanitizeBlogExcerptHtml(dto.excerpt)
        : row.excerpt;

    if (dto.coverUrl !== undefined) {
      this.assertUploadUrlAllowed(dto.coverUrl === null ? null : dto.coverUrl);
    }
    if (dto.body != null) {
      this.assertBodyMediaUrlsAllowed(resolvedNextBody);
    }
    const urlsToRemove = this.diffStorageUrlsToRemove(
      { coverUrl: row.coverUrl, body: row.body },
      { coverUrl: resolvedNextCover, body: resolvedNextBody },
    );
    const updated = await this.prisma.blogPost.update({
      where: { id },
      data: {
        ...(dto.title != null ? { title: dto.title.trim() } : {}),
        slug,
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(dto.excerpt !== undefined ? { excerpt: resolvedNextExcerpt } : {}),
        ...(dto.body != null
          ? {
              body: resolvedNextBody,
              bodySearchText: htmlToSearchText(resolvedNextBody),
            }
          : {}),
        ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
        ...(publishedAt !== undefined ? { publishedAt } : {}),
        ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl?.trim() || null } : {}),
        ...(dto.metaTitle !== undefined
          ? { metaTitle: trimOrNull(dto.metaTitle) }
          : {}),
        ...(dto.metaDescription !== undefined
          ? { metaDescription: trimOrNull(dto.metaDescription) }
          : {}),
        ...(dto.ogImageUrl !== undefined
          ? { ogImageUrl: trimOrNull(dto.ogImageUrl) }
          : {}),
        ...(dto.canonicalPath !== undefined
          ? { canonicalPath: normalizeCanonicalPath(dto.canonicalPath) }
          : {}),
        ...(dto.seoNoIndex !== undefined ? { seoNoIndex: dto.seoNoIndex } : {}),
      },
      include: { category: true },
    });
    if (urlsToRemove.length) this.scheduleStorageCleanup(urlsToRemove);
    return updated;
  }

  async deletePost(id: string) {
    const row = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Статья не найдена');
    const urls = this.collectStorageUrls(row.coverUrl, row.body);
    await this.prisma.blogPost.delete({ where: { id } });
    if (urls.length) this.scheduleStorageCleanup(urls);
    return { ok: true };
  }

  async bulkDeletePosts(dto: BulkIdsDto) {
    if (!dto.ids.length) return { deleted: [] as string[] };
    const rows = await this.prisma.blogPost.findMany({
      where: { id: { in: dto.ids } },
      select: { coverUrl: true, body: true },
    });
    const urlSet = new Set<string>();
    for (const r of rows) {
      for (const u of this.collectStorageUrls(r.coverUrl, r.body)) urlSet.add(u);
    }
    await this.prisma.blogPost.deleteMany({ where: { id: { in: dto.ids } } });
    if (urlSet.size) this.scheduleStorageCleanup([...urlSet]);
    return { deleted: dto.ids };
  }

  async reorderCategories(orderedIds: string[]) {
    const unique = new Set(orderedIds);
    if (unique.size !== orderedIds.length) {
      throw new BadRequestException('В порядке не должно быть дубликатов id');
    }
    const all = await this.prisma.blogCategory.findMany({ select: { id: true } });
    if (orderedIds.length !== all.length || orderedIds.some((id) => !all.some((c) => c.id === id))) {
      throw new BadRequestException('orderedIds должны содержать все рубрики ровно по разу');
    }
    await this.prisma.$transaction(
      orderedIds.map((id, sortOrder) =>
        this.prisma.blogCategory.update({ where: { id }, data: { sortOrder } }),
      ),
    );
    return { ok: true as const };
  }

  async reorderPosts(dto: ReorderBlogPostsDto) {
    const orderedIds = dto.orderedIds;
    const unique = new Set(orderedIds);
    if (unique.size !== orderedIds.length) {
      throw new BadRequestException('В порядке не должно быть дубликатов id');
    }
    const rows = await this.prisma.blogPost.findMany({
      where: { id: { in: orderedIds } },
      select: { id: true, sortOrder: true },
    });
    if (rows.length !== orderedIds.length) {
      throw new BadRequestException('Неизвестный id статьи');
    }
    // Перестановка sortOrder только среди переданных id (текущая страница / фильтр)
    const sorts = [...rows]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((r) => r.sortOrder);
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.blogPost.update({
          where: { id },
          data: { sortOrder: sorts[index]! },
        }),
      ),
    );
    return { ok: true as const };
  }

  async uploadCover(file: {
    buffer: Buffer;
    mimetype: string;
    size: number;
    originalname?: string;
  }) {
    const { url } = await this.storage.saveImage(file, 'blog');
    return { url };
  }

  /**
   * Удаляет локальные /uploads/… которые не привязаны ни к одной статье
   * (cover/Quill upload без Save).
   */
  async discardUploads(urls: string[]) {
    const candidates = [
      ...new Set(
        (urls ?? [])
          .map((u) => String(u ?? '').trim())
          .filter((u) => Boolean(u) && Boolean(this.storage.tryPublicUrlToKey(u))),
      ),
    ].slice(0, 50);

    if (!candidates.length) return { deleted: 0 };

    const posts = await this.prisma.blogPost.findMany({
      select: { coverUrl: true, body: true },
    });
    const referenced = new Set<string>();
    for (const p of posts) {
      for (const u of this.collectStorageUrls(p.coverUrl, p.body)) {
        referenced.add(u);
      }
    }

    let deleted = 0;
    for (const url of candidates) {
      if (referenced.has(url)) continue;
      try {
        const ok = await this.storage.deleteByPublicUrl(url);
        if (ok) deleted += 1;
      } catch (e) {
        this.logger.warn(
          `discardUploads ${url}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return { deleted };
  }

  private assertUploadUrlAllowed(url: string | null | undefined): void {
    if (url == null) return;
    const t = String(url).trim();
    if (!t) return;
    if (!this.storage.tryPublicUrlToKey(t)) {
      throw new BadRequestException('Недопустимый URL медиа (ожидается локальный /uploads/…)');
    }
  }

  private assertBodyMediaUrlsAllowed(html: string): void {
    for (const u of extractMediaUrlsFromRichHtml(html)) {
      this.assertUploadUrlAllowed(u);
    }
  }

  private collectStorageUrls(coverUrl: string | null, body: string): string[] {
    const out: string[] = [];
    const c = coverUrl?.trim();
    if (c) out.push(c);
    out.push(...extractMediaUrlsFromRichHtml(body));
    return out;
  }

  private diffStorageUrlsToRemove(
    prev: { coverUrl: string | null; body: string },
    next: { coverUrl: string | null; body: string },
  ): string[] {
    const out: string[] = [];
    const prevCover = prev.coverUrl?.trim() ?? '';
    const nextCover = next.coverUrl?.trim() ?? '';
    if (prevCover && prevCover !== nextCover) out.push(prevCover);
    const prevM = new Set(extractMediaUrlsFromRichHtml(prev.body));
    const nextM = new Set(extractMediaUrlsFromRichHtml(next.body));
    for (const u of prevM) {
      if (!nextM.has(u)) out.push(u);
    }
    return out;
  }

  private scheduleStorageCleanup(urls: string[]): void {
    if (!urls.length) return;
    void (async () => {
      for (const u of urls) {
        try {
          await this.storage.deleteByPublicUrl(u);
        } catch (e) {
          this.logger.warn(
            `Очистка uploads после статьи: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    })();
  }

  private normalizeCategoryId(raw: string | null | undefined): string | null {
    if (raw == null || raw === '') return null;
    const t = String(raw).trim();
    return t || null;
  }

  private parsePublishedAt(raw: string | null | undefined): Date | null {
    if (raw == null || String(raw).trim() === '') return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Некорректная дата');
    return d;
  }

  private async ensureUniqueCategorySlug(base: string, excludeId?: string): Promise<string> {
    let slug = base || 'category';
    let n = 0;
    while (true) {
      const clash = await this.prisma.blogCategory.findFirst({
        where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      });
      if (!clash) return slug;
      n += 1;
      slug = `${base}-${n}`;
    }
  }

  private async ensureUniquePostSlug(base: string, excludeId?: string): Promise<string> {
    let slug = base || 'post';
    let n = 0;
    while (true) {
      const clash = await this.prisma.blogPost.findFirst({
        where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      });
      if (!clash) return slug;
      n += 1;
      slug = `${base}-${n}`;
    }
  }
}
