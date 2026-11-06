function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Минимальная HTML-страница 404 для ботов (HTTP 404, noindex). */
export function buildBotNotFoundHtml(opts: {
  title: string;
  description: string;
  canonical: string;
}): string {
  const e = escapeHtml;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<title>${e(opts.title)}</title>
<meta name="description" content="${e(opts.description)}"/>
<meta name="robots" content="noindex,nofollow"/>
<link rel="canonical" href="${e(opts.canonical)}"/>
</head>
<body>
<h1>Страница не найдена</h1>
<p>${e(opts.description)}</p>
<p><a href="/">На главную</a></p>
</body>
</html>`;
}
