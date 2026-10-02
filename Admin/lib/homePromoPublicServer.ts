import { getServerApiBase } from '@/lib/serverApiBase';
import { cache } from 'react';

export type PublicHomePromoBanner = {
  id: string;
  imageUrl: string;
  href: string;
  alt: string;
  notch: boolean;
};

export type PublicHomePromoResult = {
  titleLeft: string;
  titleRight: string;
  items: PublicHomePromoBanner[];
  ok: boolean;
};

const HOME_PROMO_REVALIDATE = 120;
const HOME_PROMO_TAGS = ['home-promo'] as const;

async function homePromoGet<T>(path: string): Promise<{ data: T | null; ok: boolean }> {
  const url = `${getServerApiBase()}/${path.replace(/^\//, '')}`;
  try {
    const res = await fetch(url, {
      next: {
        revalidate: HOME_PROMO_REVALIDATE,
        tags: [...HOME_PROMO_TAGS],
      },
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.error(`[home-promo] GET ${path} → ${res.status}`);
      return { data: null, ok: false };
    }
    return { data: (await res.json()) as T, ok: true };
  } catch (err) {
    console.error(`[home-promo] GET ${path} failed`, err);
    return { data: null, ok: false };
  }
}

export const fetchPublicHomePromo = cache(async (): Promise<PublicHomePromoResult> => {
  const { data, ok } = await homePromoGet<{
    titleLeft?: string;
    titleRight?: string;
    items?: PublicHomePromoBanner[];
  }>('settings/home-promo');
  if (!ok) {
    return { titleLeft: 'НАШИ', titleRight: 'АКЦИИ', items: [], ok: false };
  }
  return {
    titleLeft: data?.titleLeft?.trim() || 'НАШИ',
    titleRight: data?.titleRight?.trim() || 'АКЦИИ',
    items: Array.isArray(data?.items) ? data.items : [],
    ok: true,
  };
});
