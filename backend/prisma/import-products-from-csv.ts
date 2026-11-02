/**
 * Импорт товаров из WB CSV (корень репо / backend).
 *
 * Запуск из backend/:
 *   npx ts-node --transpile-only prisma/import-products-from-csv.ts
 *
 * Правила (согласованы):
 * - цена 10000 ₽, stock 1000
 * - 1 строка = Product + 1 Variant
 * - slug из названия; артикул продавца только для линковки наборов
 * - sku = ТНВЭД (при коллизии суффикс -2, -3…)
 * - nationalCatalogName = Наименование
 * - оттенки из «Цвет» (`;`)
 * - фото не качаем
 * - удаляет krem-uvlazhnyayuschiy
 */
import { createReadStream } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse';
import { PrismaClient } from '@prisma/client';
import { slugify } from '../src/catalog/slug.util';

const prisma = new PrismaClient();

const DEFAULT_PRICE = 10_000;
const DEFAULT_STOCK = 1000;
const DEFAULT_VOLUME_ML = 30;

function capitalizeName(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toLocaleUpperCase('ru-RU') + t.slice(1);
}

function makeShortDescription(
  productName: string,
  descriptionHtml: string,
  categoryName: string,
): string {
  const plain = descriptionHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain) {
    const sentence = plain.split(/(?<=[.!?…])\s+/)[0] || plain;
    const clipped = sentence.length > 140 ? `${sentence.slice(0, 137).trim()}…` : sentence;
    if (clipped.length >= 24) return clipped;
  }
  return `${productName} — ${categoryName.toLowerCase()} Jcos`;
}

function variantDisplayName(volumeMl: number | null, productName: string): string {
  if (volumeMl != null && volumeMl > 0) return `${volumeMl} мл`;
  return capitalizeName(productName);
}

/** Категория продавца → зоны (CatalogTag). */
const CATEGORY_TAGS: Record<string, string[]> = {
  'BB-кремы': ['Лицо'],
  'CC-кремы': ['Лицо'],
  Туши: ['Глаза'],
  'Наборы декоративной косметики': ['Лицо', 'Глаза', 'Губы'],
  Бальзамы: ['Губы'],
  Косметички: ['Лицо'],
  'Косметические карандаши': ['Брови', 'Губы'],
  Румяна: ['Лицо'],
  Корректоры: ['Лицо'],
};

/**
 * Артикул набора → артикулы состава (только для ProductSet).
 * Ключи — «Артикул продавца» из CSV.
 */
const SET_COMPONENTS: Record<string, string[]> = {
  nabor_bb_light_mascara: ['wb_bb_01', 'wb_mascara'],
  nabor_bb_beige_mascara: ['wb_bb_02', 'wb_mascara'],
  N4product_Beige: ['wb_bb_02', 'wb_mascara', 'Lip-Balm-01caramel', '20COSMETICBAG01'],
  N4product_Light: ['wb_bb_01', 'wb_mascara', 'Lip-Balm-03pink', '20COSMETICBAG01'],
  N4product_CCLight: ['wb_cc_light', 'wb_mascara', 'Lip-Balm-02peach', '20COSMETICBAG01'],
  N2termo_Lip003pink: ['wb_mascara', 'Lip-Balm-03pink'],
  N2termo_Lip02peach: ['wb_mascara', 'Lip-Balm-02peach'],
  LCombo_03pink_NRos: ['Lip-Balm-03pink', 'Lip_Pen_NRos'],
  LCombo_01caramel_NRos: ['Lip-Balm-01caramel', 'Lip_Pen_NRos'],
  LCombo_02peach_WBrown: ['Lip-Balm-02peach', 'Lip_Pen_WBrown'],
};

type CsvRow = Record<string, string>;

function findCsvPath(): string {
  const candidates = [
    join(__dirname, '../../25.07.2026_17.49_Общие характеристики одним файлом - Товары.csv'),
    join(process.cwd(), '25.07.2026_17.49_Общие характеристики одним файлом - Товары.csv'),
    join(process.cwd(), '../25.07.2026_17.49_Общие характеристики одним файлом - Товары.csv'),
  ];
  const { existsSync, readdirSync } = require('fs') as typeof import('fs');
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // NFC/NFD filename differences on macOS
  const roots = [join(__dirname, '../..'), process.cwd(), join(process.cwd(), '..')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const hit = readdirSync(root).find((f) => f.endsWith('Товары.csv'));
    if (hit) return join(root, hit);
  }
  throw new Error('CSV не найден (ищите *Товары.csv в корне Jcos)');
}

function parseVolumeMl(name: string): number | null {
  const m = name.match(/(\d+[.,]?\d*)\s*мл/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseKgToGrams(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000);
}

function parseCmToMm(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10);
}

function splitShades(colorRaw: string): string[] {
  return colorRaw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^\d{10,}$/.test(s)); // отсечь баркоды, попавшие в цвет
}

function textToHtml(text: string): string {
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return `<p>${escapeHtml(text.trim())}</p>`;
  return parts.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`).join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Пытаемся вырезать Состав / Применение / Хранение из длинного описания WB. */
function splitDescription(raw: string): {
  descriptionHtml: string;
  compositionHtml: string | null;
  applicationHtml: string | null;
  storageHtml: string | null;
} {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) {
    return {
      descriptionHtml: '',
      compositionHtml: null,
      applicationHtml: null,
      storageHtml: null,
    };
  }

  const markers: Array<{ key: 'composition' | 'application' | 'storage'; re: RegExp }> = [
    { key: 'composition', re: /(?:^|\n)\s*(?:состав|ингредиенты)\s*[:.\-–]?\s*/i },
    {
      key: 'application',
      re: /(?:^|\n)\s*(?:применение|способ применения|как использовать|как наносить)\s*[:.\-–]?\s*/i,
    },
    {
      key: 'storage',
      re: /(?:^|\n)\s*(?:хранение|условия хранения|срок годности)\s*[:.\-–]?\s*/i,
    },
  ];

  type Hit = { key: 'composition' | 'application' | 'storage'; start: number; bodyStart: number };
  const hits: Hit[] = [];
  for (const m of markers) {
    const match = m.re.exec(text);
    if (match) {
      hits.push({ key: m.key, start: match.index, bodyStart: match.index + match[0].length });
    }
  }
  hits.sort((a, b) => a.start - b.start);

  if (!hits.length) {
    return {
      descriptionHtml: textToHtml(text),
      compositionHtml: null,
      applicationHtml: null,
      storageHtml: null,
    };
  }

  const head = text.slice(0, hits[0]!.start).trim();
  const buckets: Record<'composition' | 'application' | 'storage', string> = {
    composition: '',
    application: '',
    storage: '',
  };
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    const end = i + 1 < hits.length ? hits[i + 1]!.start : text.length;
    buckets[h.key] = text.slice(h.bodyStart, end).trim();
  }

  return {
    descriptionHtml: textToHtml(head || text),
    compositionHtml: buckets.composition ? textToHtml(buckets.composition) : null,
    applicationHtml: buckets.application ? textToHtml(buckets.application) : null,
    storageHtml: buckets.storage ? textToHtml(buckets.storage) : null,
  };
}

async function uniqueProductSlug(base: string, excludeId?: string) {
  let slug = base.slice(0, 80) || 'product';
  let n = 2;
  for (;;) {
    const found = await prisma.product.findUnique({ where: { slug } });
    if (!found || found.id === excludeId) return slug;
    slug = `${base.slice(0, 70)}-${n++}`;
  }
}

async function uniqueProductSetSlug(base: string, excludeId?: string) {
  let slug = base.slice(0, 80) || 'set';
  let n = 2;
  for (;;) {
    const found = await prisma.productSet.findUnique({ where: { slug } });
    if (!found || found.id === excludeId) return slug;
    slug = `${base.slice(0, 70)}-${n++}`;
  }
}

async function uniqueSku(base: string, excludeId?: string) {
  const root = (base || 'sku').slice(0, 80);
  let sku = root;
  let n = 2;
  for (;;) {
    const found = await prisma.productVariant.findUnique({ where: { sku } });
    if (!found || found.id === excludeId) return sku;
    sku = `${root.slice(0, 70)}-${n++}`;
  }
}

async function ensureCategory(name: string, sortOrder: number) {
  const slug = slugify(name);
  return prisma.category.upsert({
    where: { slug },
    create: { name, slug, sortOrder },
    update: { name },
  });
}

async function ensureTag(name: string, sortOrder: number) {
  const slug = slugify(name);
  return prisma.catalogTag.upsert({
    where: { slug },
    create: { name, slug, sortOrder },
    update: { name },
  });
}

async function loadCsvRows(path: string): Promise<CsvRow[]> {
  const records: string[][] = await new Promise((resolve, reject) => {
    const out: string[][] = [];
    createReadStream(path)
      .pipe(
        parse({
          relax_column_count: true,
          skip_empty_lines: false,
        }),
      )
      .on('data', (r: string[]) => out.push(r))
      .on('error', reject)
      .on('end', () => resolve(out));
  });

  const headerIdx = records.findIndex(
    (r) => r[0] === 'Группа' && r.includes('Наименование') && r.includes('ТНВЭД'),
  );
  if (headerIdx < 0) throw new Error('Не найдена строка заголовков CSV');
  const header = records[headerIdx]!;
  const rows: CsvRow[] = [];
  for (const r of records.slice(headerIdx + 1)) {
    if (!r || !r.some((c) => c?.trim())) continue;
    const obj: CsvRow = {};
    header.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim();
    });
    const name = obj['Наименование'] ?? '';
    if (!name || name.startsWith('Категория выбирается')) continue;
    if (!(obj['Группа'] ?? '').match(/^\d+$/)) continue;
    rows.push(obj);
  }
  return rows;
}

async function main() {
  const csvPath = findCsvPath();
  console.log(`[import] CSV: ${csvPath}`);
  const rows = await loadCsvRows(csvPath);
  console.log(`[import] rows: ${rows.length}`);

  const demo = await prisma.product.findUnique({ where: { slug: 'krem-uvlazhnyayuschiy' } });
  if (demo) {
    await prisma.product.delete({ where: { id: demo.id } });
    console.log('[import] deleted krem-uvlazhnyayuschiy');
  }

  const categoryNames = [...new Set(rows.map((r) => r['Категория продавца']).filter(Boolean))];
  const categoryByName = new Map<string, { id: string; name: string }>();
  for (let i = 0; i < categoryNames.length; i++) {
    const name = categoryNames[i]!;
    const cat = await ensureCategory(name, i);
    categoryByName.set(name, cat);
  }

  const allTagNames = [
    ...new Set(Object.values(CATEGORY_TAGS).flat()),
  ];
  const tagByName = new Map<string, string>();
  for (let i = 0; i < allTagNames.length; i++) {
    const name = allTagNames[i]!;
    const tag = await ensureTag(name, i);
    tagByName.set(name, tag.id);
  }

  const articleToProductId = new Map<string, string>();
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const name = row['Наименование']!;
    const sellerArticle = row['Артикул продавца'] || '';
    const categoryName = row['Категория продавца'] || 'Без категории';
    const category = categoryByName.get(categoryName) ?? (await ensureCategory(categoryName, 99));
    const shades = splitShades(row['Цвет'] || '').map(capitalizeName);
    const volumeMl = parseVolumeMl(name) ?? DEFAULT_VOLUME_ML;
    const tnved = (row['ТНВЭД'] || '').replace(/\s+/g, '');
    const blocks = splitDescription(row['Описание'] || '');
    const weightGrams = parseKgToGrams(row['Вес с упаковкой (кг)'] || '');
    const heightMm = parseCmToMm(row['Высота упаковки'] || '');
    const lengthMm = parseCmToMm(row['Длина упаковки'] || '');
    const widthMm = parseCmToMm(row['Ширина упаковки'] || '');

    // slug: название + оттенок (без «— …» в display name)
    const slugBase = slugify([name, shades.join(' ')].filter(Boolean).join(' '));
    const displayName = name;
    const variantName = variantDisplayName(volumeMl, displayName);
    const shortDescription = makeShortDescription(
      displayName,
      blocks.descriptionHtml,
      categoryName,
    );

    const tagNames = CATEGORY_TAGS[categoryName] ?? [];
    // карандаши: брови vs губы по названию
    let resolvedTags = [...tagNames];
    if (categoryName === 'Косметические карандаши') {
      if (/губ/i.test(name)) resolvedTags = ['Губы'];
      else if (/бров/i.test(name)) resolvedTags = ['Брови'];
    }

    const existing = await prisma.product.findUnique({
      where: { slug: slugBase },
      include: { variants: { include: { shades: true } } },
    });

    let productId: string;
    if (existing) {
      productId = existing.id;
      await prisma.product.update({
        where: { id: productId },
        data: {
          name: displayName,
          shortDescription,
          descriptionHtml: blocks.descriptionHtml || null,
          applicationHtml: blocks.applicationHtml,
          compositionHtml: blocks.compositionHtml,
          compositionSearchText: [
            blocks.compositionHtml,
            blocks.descriptionHtml,
          ]
            .filter(Boolean)
            .map((h) =>
              String(h)
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim(),
            )
            .filter(Boolean)
            .join('\n') || null,
          storageHtml: blocks.storageHtml,
          categoryId: category.id,
          active: true,
        },
      });
      updated++;
    } else {
      const slug = await uniqueProductSlug(slugBase);
      const product = await prisma.product.create({
        data: {
          name: displayName,
          slug,
          shortDescription,
          descriptionHtml: blocks.descriptionHtml || null,
          applicationHtml: blocks.applicationHtml,
          compositionHtml: blocks.compositionHtml,
          compositionSearchText: [
            blocks.compositionHtml,
            blocks.descriptionHtml,
          ]
            .filter(Boolean)
            .map((h) =>
              String(h)
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim(),
            )
            .filter(Boolean)
            .join('\n') || null,
          storageHtml: blocks.storageHtml,
          categoryId: category.id,
          active: true,
        },
      });
      productId = product.id;
      created++;
    }

    await prisma.productCatalogTag.deleteMany({ where: { productId } });
    if (resolvedTags.length) {
      await prisma.productCatalogTag.createMany({
        data: resolvedTags
          .map((t) => tagByName.get(t))
          .filter((id): id is string => Boolean(id))
          .map((tagId) => ({ productId, tagId })),
        skipDuplicates: true,
      });
    }

    const skuBase = tnved || `sku-${slugify(name)}`;
    let variant = existing?.variants[0];
    if (variant) {
      const sku = await uniqueSku(skuBase, variant.id);
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: {
          name: variantName,
          slug: slugify(variantName),
          nationalCatalogName: name,
          volumeMl,
          sku,
          price: DEFAULT_PRICE,
          stock: DEFAULT_STOCK,
          stockReserve: 0,
          orderMinQty: 1,
          orderMaxQty: null,
          weightGrams,
          lengthMm,
          widthMm,
          heightMm,
          active: true,
        },
      });
      await prisma.productVariantShade.deleteMany({ where: { variantId: variant.id } });
      if (shades.length) {
        await prisma.productVariantShade.createMany({
          data: shades.map((shadeName, sortOrder) => ({
            variantId: variant!.id,
            name: shadeName,
            sortOrder,
          })),
        });
      }
    } else {
      const sku = await uniqueSku(skuBase);
      const vSlug = await (async () => {
        let s = slugify(variantName);
        let n = 2;
        for (;;) {
          const found = await prisma.productVariant.findFirst({
            where: { productId, slug: s },
          });
          if (!found) return s;
          s = `${slugify(variantName)}-${n++}`;
        }
      })();
      variant = await prisma.productVariant.create({
        data: {
          productId,
          name: variantName,
          slug: vSlug,
          nationalCatalogName: name,
          volumeMl,
          sku,
          price: DEFAULT_PRICE,
          stock: DEFAULT_STOCK,
          orderMinQty: 1,
          weightGrams,
          lengthMm,
          widthMm,
          heightMm,
          active: true,
          shades: shades.length
            ? {
                create: shades.map((shadeName, sortOrder) => ({
                  name: shadeName,
                  sortOrder,
                })),
              }
            : undefined,
        },
        include: { shades: true },
      });
    }

    if (sellerArticle) articleToProductId.set(sellerArticle, productId);
    console.log(
      `[import] ${existing ? 'upd' : 'new'} ${sellerArticle || '—'} → ${name.slice(0, 60)} (sku=${tnved || 'auto'})`,
    );
  }

  // ProductSets для наборов
  let sets = 0;
  for (const row of rows) {
    const cat = row['Категория продавца'] || '';
    if (!cat.includes('Набор')) continue;
    const article = row['Артикул продавца'] || '';
    const name = row['Наименование'] || '';
    const naborProductId = articleToProductId.get(article);
    if (!naborProductId) continue;

    const componentArticles = SET_COMPONENTS[article] ?? [];
    const productIds = [
      naborProductId,
      ...componentArticles
        .map((a) => articleToProductId.get(a))
        .filter((id): id is string => Boolean(id)),
    ];
    const uniqueIds = [...new Set(productIds)];

    const setSlugBase = `${slugify(article || name)}-set`;
    const existingSet = await prisma.productSet.findUnique({ where: { slug: setSlugBase } });

    let setId: string;
    if (existingSet) {
      setId = existingSet.id;
      await prisma.productSet.update({
        where: { id: setId },
        data: { name, active: true, shortDescription: null },
      });
      await prisma.productSetItem.deleteMany({ where: { productSetId: setId } });
    } else {
      const setSlug = await uniqueProductSetSlug(setSlugBase);
      const createdSet = await prisma.productSet.create({
        data: {
          name,
          slug: setSlug,
          active: true,
          sortOrder: sets,
        },
      });
      setId = createdSet.id;
    }

    await prisma.productSetItem.createMany({
      data: uniqueIds.map((productId, sortOrder) => ({
        productSetId: setId,
        productId,
        sortOrder,
      })),
      skipDuplicates: true,
    });
    sets++;
    console.log(`[import] set «${name.slice(0, 50)}» items=${uniqueIds.length}`);
  }

  console.log(`[import] done: created=${created} updated=${updated} sets=${sets}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
