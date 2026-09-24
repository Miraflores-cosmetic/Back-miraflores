'use client';

import { useEffect, useState, type RefObject } from 'react';

/** Вкладка активна и панель чата пересекается с viewport (для mark read). */
export function useOrderChatPanelVisible(
  rootRef: RefObject<Element | null>,
  active = true,
): boolean {
  const [intersects, setIntersects] = useState(false);
  const [docVisible, setDocVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVis = () => setDocVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!active) {
      setIntersects(false);
      return undefined;
    }
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIntersects(false);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.2);
        setIntersects(hit);
      },
      { threshold: [0, 0.2, 0.5, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootRef, active]);

  return active && docVisible && intersects;
}
