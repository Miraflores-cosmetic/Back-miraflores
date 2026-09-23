import {
  escapeHtml,
  MAIL_BRAND,
  mailCtaButton,
  renderMirafloresEmailLayout,
} from './email-layout';
import type { BuiltEmail } from './email-templates';

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Узкий whitelist {{#if key}}…{{/if}} (без else / вложенности / выражений).
 * Truthy = непустая строка после trim / число ≠ 0.
 */
export const EMAIL_IF_ALLOWED_KEYS = [
  'order.tracking',
  'order.tracking_block',
  'order.pay_url',
  'order.items_text',
  'order.items_html',
  'order.subtotal_label',
  'order.shipping_label',
  'order.discount_label',
  'order.gift_label',
  'order.totals_block',
  'order.changes_summary',
  'order.refund_intro',
  'order.refund_label',
  'gift.items_text',
  'gift.items_html',
  'gift.buyer_email',
  'gift.recipient_email',
] as const;

const IF_BLOCK_RE =
  /\{\{#if\s+([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;

/** Trusted HTML vars (уже escapeHtml внутри ячеек на этапе format). */
export const EMAIL_HTML_VAR_KEYS = [
  'order.items_html',
  'gift.items_html',
] as const;

/** Whitelist rich snippets (не plain-text vars). */
export const EMAIL_SNIPPET_KEYS = [
  'cta.pay',
  'cta.order',
  'cta.site',
  'block.order_card',
  'block.items',
  'block.gift_items',
  'block.totals',
] as const;

export type EmailSnippetKey = (typeof EMAIL_SNIPPET_KEYS)[number];

export function isEmailSnippetKey(value: string): value is EmailSnippetKey {
  return (EMAIL_SNIPPET_KEYS as readonly string[]).includes(value);
}

export function isEmailHtmlVarKey(value: string): boolean {
  return (EMAIL_HTML_VAR_KEYS as readonly string[]).includes(value);
}

export function isEmailIfAllowedKey(value: string): boolean {
  return (EMAIL_IF_ALLOWED_KEYS as readonly string[]).includes(value);
}

/** Плоский словарь: ключ как в шаблоне (`order.number`). */
export type EmailTemplateVars = Record<string, string | number | null | undefined>;

export function isTruthyEmailVar(v: string | number | null | undefined): boolean {
  if (v == null) return false;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  return String(v).trim().length > 0;
}

/**
 * Раскрывает {{#if key}}…{{/if}}. Неизвестный key → strip (или throw в strict).
 */
export function expandIfBlocks(
  template: string,
  vars: EmailTemplateVars,
  opts?: { strict?: boolean },
): string {
  return template.replace(IF_BLOCK_RE, (_m, rawKey: string, inner: string) => {
    const key = rawKey.trim();
    if (!isEmailIfAllowedKey(key)) {
      if (opts?.strict) {
        throw new Error(`Недопустимое условие {{#if ${key}}}`);
      }
      return '';
    }
    return isTruthyEmailVar(vars[key]) ? inner : '';
  });
}

/** Ключи, использованные в {{#if …}}. */
export function extractIfConditionKeys(...parts: string[]): string[] {
  const found = new Set<string>();
  for (const part of parts) {
    for (const m of part.matchAll(IF_BLOCK_RE)) {
      found.add(m[1].trim());
    }
  }
  return [...found].sort();
}

export function interpolateTemplate(
  template: string,
  vars: EmailTemplateVars,
  opts: { escape: boolean },
): string {
  return template.replace(PLACEHOLDER_RE, (_m, rawKey: string) => {
    const key = rawKey.trim();
    if (isEmailSnippetKey(key) || isEmailHtmlVarKey(key)) {
      return opts.escape ? '' : snippetTextFallback(key, vars);
    }
    const v = vars[key];
    if (v == null) return '';
    const s = String(v);
    return opts.escape ? escapeHtml(s) : s;
  });
}

/** Plain body → HTML paragraphs внутри фирменного layout. */
export function plainBodyToHtml(escapedInterpolatedBody: string): string {
  const trimmed = escapedInterpolatedBody.replace(/\r\n/g, '\n').trim();
  if (!trimmed) {
    return `<p style="margin:0;"></p>`;
  }
  const blocks = trimmed.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const withBreaks = block
        .split('\n')
        .map((line) => line.trimEnd())
        .join('<br/>\n');
      return `<p style="margin:0 0 16px;white-space:normal;">${withBreaks}</p>`;
    })
    .join('');
}

function snippetTextFallback(key: string, vars: EmailTemplateVars): string {
  switch (key) {
    case 'cta.pay':
      return String(vars['order.pay_url'] ?? '').trim();
    case 'cta.order':
      return String(vars['order.url'] ?? '').trim();
    case 'cta.site':
      return String(vars['site.url'] ?? '').trim();
    case 'block.order_card': {
      const n = String(vars['order.number'] ?? '').trim();
      const total = String(vars['order.total_label'] ?? '').trim();
      return total ? `Заказ ${n} · ${total}` : `Заказ ${n}`;
    }
    case 'block.items':
    case 'order.items_html':
      return String(vars['order.items_text'] ?? '').trim();
    case 'block.gift_items':
    case 'gift.items_html':
      return String(vars['gift.items_text'] ?? '').trim();
    case 'block.totals':
      return String(vars['order.totals_block'] ?? '').trim();
    default:
      return '';
  }
}

function orderCardHtml(vars: EmailTemplateVars): string {
  const number = String(vars['order.number'] ?? '').trim();
  const total = String(vars['order.total_label'] ?? '').trim();
  if (!number) return '';
  const extra = total
    ? `<p style="margin:10px 0 0;font-size:14px;color:${MAIL_BRAND.ink};">Сумма: <strong>${escapeHtml(total)}</strong></p>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;background:${MAIL_BRAND.sand};border:1px solid ${MAIL_BRAND.line};border-radius:4px;">
  <tr>
    <td style="padding:16px 18px;">
      <p style="margin:0;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Номер заказа</p>
      <p style="margin:6px 0 0;font-size:18px;font-family:Georgia,'Times New Roman',serif;color:${MAIL_BRAND.green};">${escapeHtml(number)}</p>
      ${extra}
    </td>
  </tr>
</table>`;
}

/** Список «• …» / «Состав…» → компактная таблица. */
export function bulletListToHtml(text: string): string {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  const rows = lines.filter((l) => l.startsWith('•') || l.startsWith('-'));
  const heading = lines.find((l) => !l.startsWith('•') && !l.startsWith('-'));
  const items = (rows.length ? rows : lines).map((l) =>
    l.replace(/^[•\-]\s*/, ''),
  );
  const head = heading
    ? `<p style="margin:16px 0 8px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MAIL_BRAND.muted};">${escapeHtml(heading)}</p>`
    : '';
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border:1px solid ${MAIL_BRAND.line};border-radius:4px;overflow:hidden;">
${items
  .map(
    (it, i) => `  <tr>
    <td style="padding:10px 14px;font-size:14px;line-height:1.45;color:${MAIL_BRAND.ink};border-top:${i === 0 ? '0' : `1px solid ${MAIL_BRAND.line}`};">${escapeHtml(it)}</td>
  </tr>`,
  )
  .join('\n')}
</table>`;
  return `${head}${table}`;
}

function totalsBlockHtml(vars: EmailTemplateVars): string {
  const text = String(vars['order.totals_block'] ?? '').trim();
  if (!text) return '';
  return bulletListToHtml(
    text
      .split('\n')
      .map((l) => (l.startsWith('•') ? l : `• ${l}`))
      .join('\n'),
  );
}

function snippetHtml(key: EmailSnippetKey, vars: EmailTemplateVars): string {
  switch (key) {
    case 'cta.pay': {
      const href = String(vars['order.pay_url'] ?? '').trim();
      return href ? mailCtaButton(href, 'Оплатить') : '';
    }
    case 'cta.order': {
      const href = String(vars['order.url'] ?? '').trim();
      return href ? mailCtaButton(href, 'Смотреть заказ') : '';
    }
    case 'cta.site': {
      const href = String(vars['site.url'] ?? '').trim();
      return href ? mailCtaButton(href, 'На сайт Miraflores') : '';
    }
    case 'block.order_card':
      return orderCardHtml(vars);
    case 'block.items': {
      const html = String(vars['order.items_html'] ?? '').trim();
      if (html) return html;
      return bulletListToHtml(String(vars['order.items_text'] ?? ''));
    }
    case 'block.gift_items': {
      const html = String(vars['gift.items_html'] ?? '').trim();
      if (html) return html;
      return bulletListToHtml(String(vars['gift.items_text'] ?? ''));
    }
    case 'block.totals':
      return totalsBlockHtml(vars);
    default:
      return '';
  }
}

function maybeAutoCtaHtml(plainBlock: string, vars: EmailTemplateVars): string | null {
  const t = plainBlock.trim();
  if (!t || /\s/.test(t)) return null;
  const pay = String(vars['order.pay_url'] ?? '').trim();
  const order = String(vars['order.url'] ?? '').trim();
  const site = String(vars['site.url'] ?? '').trim();
  if (pay && t === pay) return mailCtaButton(pay, 'Оплатить');
  if (order && t === order) return mailCtaButton(order, 'Смотреть заказ');
  if (site && t === site) return mailCtaButton(site, 'На сайт Miraflores');
  return null;
}

function maybeItemsBlockHtml(plainBlock: string): string | null {
  const t = plainBlock.trim();
  if (!t) return null;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const bulletCount = lines.filter((l) => l.startsWith('•') || l.startsWith('-')).length;
  if (bulletCount >= 1) return bulletListToHtml(t);
  return null;
}

type BodySeg =
  | { kind: 'text'; value: string }
  | { kind: 'snippet'; key: EmailSnippetKey }
  | { kind: 'html'; value: string };

function splitBodySegments(template: string, vars: EmailTemplateVars): BodySeg[] {
  const segs: BodySeg[] = [];
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    const key = m[1].trim();
    const idx = m.index ?? 0;
    if (idx > last) {
      segs.push({ kind: 'text', value: template.slice(last, idx) });
    }
    if (isEmailSnippetKey(key)) {
      segs.push({ kind: 'snippet', key });
    } else if (isEmailHtmlVarKey(key)) {
      const html = String(vars[key] ?? '').trim();
      if (html) segs.push({ kind: 'html', value: html });
    } else {
      segs.push({ kind: 'text', value: m[0] });
    }
    last = idx + m[0].length;
  }
  if (last < template.length) {
    segs.push({ kind: 'text', value: template.slice(last) });
  }
  return segs;
}

function renderBodyHtmlFromTemplate(
  bodyTemplate: string,
  vars: EmailTemplateVars,
): string {
  const expanded = expandIfBlocks(bodyTemplate, vars);
  const segs = splitBodySegments(expanded, vars);
  const htmlParts: string[] = [];

  for (const seg of segs) {
    if (seg.kind === 'snippet') {
      const html = snippetHtml(seg.key, vars);
      if (html) htmlParts.push(html);
      continue;
    }
    if (seg.kind === 'html') {
      htmlParts.push(seg.value);
      continue;
    }
    const raw = interpolateTemplate(seg.value, vars, { escape: false });
    if (!raw.trim()) continue;
    const blocks = raw.replace(/\r\n/g, '\n').split(/\n{2,}/);
    for (const block of blocks) {
      if (!block.trim()) continue;
      const autoCta = maybeAutoCtaHtml(block, vars);
      if (autoCta) {
        htmlParts.push(autoCta);
        continue;
      }
      const items = maybeItemsBlockHtml(block);
      if (items) {
        htmlParts.push(items);
        continue;
      }
      const escaped = escapeHtml(block)
        .split('\n')
        .map((line) => line.trimEnd())
        .join('<br/>\n');
      htmlParts.push(
        `<p style="margin:0 0 16px;white-space:normal;">${escaped}</p>`,
      );
    }
  }

  return htmlParts.join('') || `<p style="margin:0;"></p>`;
}

function renderBodyTextFromTemplate(
  bodyTemplate: string,
  vars: EmailTemplateVars,
): string {
  const expanded = expandIfBlocks(bodyTemplate, vars);
  return interpolateTemplate(expanded, vars, { escape: false })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderEditableEmail(opts: {
  subjectTemplate: string;
  bodyTemplate: string;
  vars: EmailTemplateVars;
  siteUrl?: string | null;
  preheader?: string | null;
}): BuiltEmail {
  const site =
    (opts.siteUrl ?? '').replace(/\/+$/, '') ||
    String(opts.vars['site.url'] ?? '').replace(/\/+$/, '') ||
    'https://miraflores-shop.com';

  const vars: EmailTemplateVars = {
    'site.name': MAIL_BRAND.name,
    'site.url': site,
    ...opts.vars,
  };

  const subjectExpanded = expandIfBlocks(opts.subjectTemplate, vars);
  const subject = interpolateTemplate(subjectExpanded, vars, {
    escape: false,
  })
    .replace(/\s+/g, ' ')
    .trim();
  const text = renderBodyTextFromTemplate(opts.bodyTemplate, vars);
  const bodyHtml = renderBodyHtmlFromTemplate(opts.bodyTemplate, vars);
  const preheader =
    (opts.preheader ?? '').trim() || subject.slice(0, 120);

  return {
    subject: subject || MAIL_BRAND.name,
    text,
    html: renderMirafloresEmailLayout({
      preheader,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Извлекает имена плейсхолдеров из subject+body (для валидации в админке). */
export function extractTemplatePlaceholders(...parts: string[]): string[] {
  const found = new Set<string>();
  const withoutIf = parts.map((p) => p.replace(IF_BLOCK_RE, '$2'));
  for (const part of withoutIf) {
    for (const m of part.matchAll(PLACEHOLDER_RE)) {
      found.add(m[1].trim());
    }
  }
  return [...found].sort();
}
