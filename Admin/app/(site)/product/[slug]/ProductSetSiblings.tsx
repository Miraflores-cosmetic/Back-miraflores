'use client';

import { useEffect, useState } from 'react';
import { Recommendations } from '@/sections/home/Recommendations/Recommendations';
import { useBuyerAuth } from '@/lib/BuyerAuthProvider';
import {
  fetchPublicSetSiblingsClient,
  toProductCardProps,
  type PublicSetSibling,
} from '@/lib/publicCatalog';

export function ProductSetSiblings({
  slug,
  initialItems,
}: {
  slug: string;
  initialItems: PublicSetSibling[];
}) {
  const { ready, authenticated } = useBuyerAuth();
  const [items, setItems] = useState(initialItems);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void (async () => {
      const fresh = await fetchPublicSetSiblingsClient(slug);
      setItems(fresh);
    })();
  }, [ready, authenticated, slug]);

  if (!items.length) return null;

  return (
    <Recommendations
      id="product-recommendations"
      title="Наборы"
      items={items.map(toProductCardProps)}
    />
  );
}
