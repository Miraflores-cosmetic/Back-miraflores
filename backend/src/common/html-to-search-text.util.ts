/** HTML → plain text for ILIKE / pg_trgm search columns. */
export function htmlToSearchText(
  html: string | null | undefined,
): string | null {
  if (html == null) return null;
  const plain = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return plain || null;
}

/**
 * Plain blob for product secondary search: состав + описание + действие/эффект.
 * Пишется в Product.compositionSearchText (историческое имя колонки).
 */
export function buildProductContentSearchText(fields: {
  compositionHtml?: string | null;
  descriptionHtml?: string | null;
  actionEffectHtml?: string | null;
}): string | null {
  const parts = [
    htmlToSearchText(fields.compositionHtml),
    htmlToSearchText(fields.descriptionHtml),
    htmlToSearchText(fields.actionEffectHtml),
  ].filter((p): p is string => Boolean(p));
  if (!parts.length) return null;
  return parts.join('\n');
}

/**
 * Короткие HTML-токены (div/href/span…) не должны бить composition/body:
 * даже после strip в тексте могут остаться обломки атрибутов.
 */
const HTML_NOISE_QUERIES = new Set([
  'a',
  'alt',
  'article',
  'b',
  'blockquote',
  'body',
  'br',
  'button',
  'class',
  'div',
  'em',
  'fill',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'head',
  'header',
  'height',
  'href',
  'html',
  'i',
  'id',
  'img',
  'input',
  'label',
  'li',
  'link',
  'main',
  'meta',
  'nav',
  'ol',
  'p',
  'path',
  'rel',
  'script',
  'section',
  'span',
  'src',
  'stroke',
  'strong',
  'style',
  'svg',
  'table',
  'td',
  'th',
  'tr',
  'type',
  'u',
  'ul',
  'width',
  'xmlns',
]);

export function isHtmlNoiseQuery(q: string): boolean {
  const n = q
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я_-]+/gi, '');
  return Boolean(n) && HTML_NOISE_QUERIES.has(n);
}
