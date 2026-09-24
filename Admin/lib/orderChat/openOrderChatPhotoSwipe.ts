'use client';

let lightboxModule: typeof import('photoswipe/lightbox') | null = null;

/** PhotoSwipe (lazy): листание вложений беседы. */
export async function openOrderChatPhotoSwipe(urls: string[], startIndex: number): Promise<void> {
  const clean = urls.map((u) => u.trim()).filter(Boolean);
  if (clean.length === 0 || typeof window === 'undefined') return;
  const index = Math.max(0, Math.min(startIndex, clean.length - 1));

  if (!lightboxModule) {
    lightboxModule = await import('photoswipe/lightbox');
    await import('photoswipe/style.css');
  }
  const PhotoSwipeLightbox = lightboxModule.default;

  const dataSource = clean.map((src) => ({
    src,
    width: 1600,
    height: 1200,
  }));

  const lightbox = new PhotoSwipeLightbox({
    dataSource,
    pswpModule: () => import('photoswipe'),
    showHideAnimationType: 'zoom',
  });
  lightbox.init();
  lightbox.loadAndOpen(index);
  lightbox.on('close', () => {
    lightbox.destroy();
  });
}
