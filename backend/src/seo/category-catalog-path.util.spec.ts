import { describe, expect, it } from 'vitest';
import { uniqueCategoryCatalogPaths } from './category-catalog-path.util';

describe('uniqueCategoryCatalogPaths', () => {
  const t0 = new Date('2025-01-01');

  it('single root category', () => {
    const m = uniqueCategoryCatalogPaths([
      { id: 'a', slug: 'creams', parentId: null, updatedAt: t0 },
    ]);
    expect([...m.entries()]).toEqual([['/catalog/creams', t0]]);
  });

  it('root + child → /catalog/root/child', () => {
    const m = uniqueCategoryCatalogPaths([
      { id: 'root', slug: 'face', parentId: null, updatedAt: t0 },
      {
        id: 'child',
        slug: 'creams',
        parentId: 'root',
        updatedAt: new Date('2025-06-01'),
      },
    ]);
    expect(m.get('/catalog/face')).toEqual(t0);
    expect(m.get('/catalog/face/creams')).toEqual(new Date('2025-06-01'));
  });

  it('three levels → grandchild URL через корень (без середины в пути), middle — свой URL', () => {
    const m = uniqueCategoryCatalogPaths([
      { id: 'l1', slug: 'face', parentId: null, updatedAt: t0 },
      { id: 'l2', slug: 'moisture', parentId: 'l1', updatedAt: t0 },
      {
        id: 'l3',
        slug: 'creams',
        parentId: 'l2',
        updatedAt: new Date('2025-03-01'),
      },
    ]);
    expect(m.get('/catalog/face/creams')).toEqual(new Date('2025-03-01'));
    expect(m.get('/catalog/face/moisture')).toEqual(t0);
  });
});
