import { ConfigService } from '@nestjs/config';

/** Базовый URL витрины для абсолютных ссылок (sitemap, robots). Без хвостового /. */
export function resolvePublicSiteUrl(config: ConfigService): string {
  const raw =
    config.get<string>('PUBLIC_SITE_URL')?.trim() ||
    config.get<string>('FRONTEND_PUBLIC_URL')?.trim() ||
    '';
  if (!raw) return 'https://miraflores-shop.com';
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withProto);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'https://miraflores-shop.com';
    }
    return `${u.protocol}//${u.host}`.replace(/\/+$/, '');
  } catch {
    return 'https://miraflores-shop.com';
  }
}
