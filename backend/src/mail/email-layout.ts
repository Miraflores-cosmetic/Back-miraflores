/** Общий HTML-каркас писем Miraflores (table-layout для клиентов почты). */

export const MAIL_BRAND = {
  name: 'Miraflores',
  green: '#297c3b',
  greenDark: '#1f5f2d',
  ink: '#2a2a28',
  muted: '#6e6d67',
  line: '#e5e3dc',
  sand: '#f7f5f0',
  white: '#ffffff',
  replyHint: 'info@miraflores-shop.ru',
} as const;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeHtml(s: string): string {
  return esc(s);
}

export type MailLayoutInput = {
  /** Preheader в ленте inbox */
  preheader?: string;
  /** Основной HTML внутри карточки (уже безопасный / собранный нами) */
  bodyHtml: string;
  /** Абсолютный URL витрины (футер) */
  siteUrl?: string | null;
};

/**
 * Каркас: песочный фон, белая карточка, зелёный wordmark, футер.
 * Без внешних картинок по умолчанию (надёжно в Gmail/Yandex).
 */
export function renderMirafloresEmailLayout(input: MailLayoutInput): string {
  const { green, greenDark, ink, muted, line, sand, white, name, replyHint } =
    MAIL_BRAND;
  const pre = esc((input.preheader ?? '').trim());
  const site = (input.siteUrl ?? '').replace(/\/+$/, '');
  const siteLink = site
    ? `<a href="${esc(site)}" style="color:${green};text-decoration:none">${esc(site.replace(/^https?:\/\//, ''))}</a>`
    : `<span style="color:${muted}">miraflores.ru</span>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>${esc(name)}</title>
</head>
<body style="margin:0;padding:0;background:${sand};-webkit-text-size-adjust:100%;">
${pre ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${pre}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${sand};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${white};border-radius:4px;overflow:hidden;border:1px solid ${line};">
        <tr>
          <td style="padding:28px 32px 8px;border-bottom:1px solid ${line};">
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:0.14em;text-transform:uppercase;color:${green};line-height:1.2;">
              ${esc(name)}
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 8px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${ink};">
            ${input.bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 28px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${muted};border-top:1px solid ${line};">
            <p style="margin:16px 0 0;">С заботой,<br/><span style="color:${greenDark};font-weight:600">${esc(name)}</span></p>
            <p style="margin:12px 0 0;">${siteLink}
              · <a href="mailto:${esc(replyHint)}" style="color:${muted};text-decoration:none">${esc(replyHint)}</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function mailCtaButton(href: string, label: string): string {
  const { green, white } = MAIL_BRAND;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
  <tr>
    <td style="border-radius:2px;background:${green};">
      <a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:${white};text-decoration:none;letter-spacing:0.02em;">
        ${esc(label)}
      </a>
    </td>
  </tr>
</table>`;
}

export function mailMutedNote(text: string): string {
  const { muted } = MAIL_BRAND;
  return `<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:${muted};">${esc(text)}</p>`;
}
