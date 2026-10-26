# GET `/settings/home` — Home CMS bundle

Public BFF for the storefront Home page: one HTTP round-trip for CMS-driven blocks.

## Response

| Key | Same as |
|-----|---------|
| `hero` | `GET /settings/hero` |
| `promo` | `GET /settings/home-promo` |
| `sets` | `GET /settings/homepage-sets` |
| `faq` | `GET /settings/faq` |
| `gratitude` | `GET /settings/gratitude` |
| `bestsellers` | `GET /catalog/products?collection=bestsellery&limit=12&page=1` (items + total) |
| `generatedAt` | ISO timestamp (bundle assembly time) |

## Auth

- **Guest** — no JWT required (current).
- **Optional JWT later** — pass `Authorization` when group pricing on bestsellers is needed; same as catalog list.

## Cache / revalidate

- **HTTP:** `Cache-Control: public, max-age=60, stale-while-revalidate=300` on the BFF response. CDN/proxy may cache ~1 minute; browsers may serve stale up to 5 minutes while revalidating.
- **Front:** `getHomeBundle()` in `settingsApi.ts` dedupes concurrent requests (in-flight + short-lived memory cache). Individual block endpoints remain for `/faq`, admin previews, and fallbacks.
- **Invalidation:** after admin saves hero/promo/sets/faq/gratitude or bestsellers collection — wait for HTTP max-age or hard refresh; no tag-based purge yet.

## Front usage

`HomeCmsProvider` on `/` loads the bundle once; sections read from context and skip duplicate fetches when data is present.
