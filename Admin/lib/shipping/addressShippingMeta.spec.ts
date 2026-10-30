import { describe, expect, it } from 'vitest';
import {
  buildJcosAddress2WithMeta,
  parseJcosAddressMeta,
} from './addressShippingMeta';

describe('addressShippingMeta cc/cid', () => {
  it('пишет и читает cid и cc для СДЭК', () => {
    const line = buildJcosAddress2WithMeta(
      {
        carrier: 'cdek',
        dropoff: 'pvz',
        pvzId: 'ALA1',
        cid: '4961',
        cc: 'KZ',
        lat: 43.2,
        lon: 76.9,
      },
      'комментарий',
    );
    expect(line.startsWith('__JCOS:carrier=cdek|')).toBe(true);
    expect(line).toContain('|pvz=ALA1');
    expect(line).toContain('|cid=4961');
    expect(line).toContain('|cc=KZ');

    const { meta, comment } = parseJcosAddressMeta(line);
    expect(meta?.carrier).toBe('cdek');
    expect(meta?.dropoff).toBe('pvz');
    expect(meta?.pvzId).toBe('ALA1');
    expect(meta?.cid).toBe('4961');
    expect(meta?.cc).toBe('KZ');
    expect(comment).toBe('комментарий');
  });

  it('читает legacy VSP с cc', () => {
    const { meta } = parseJcosAddressMeta(
      '__VSP:carrier=cdek|lon=|lat=|pvz=MSQ12|dropoff=pvz|cid=158|cc=BY__',
    );
    expect(meta?.cc).toBe('BY');
    expect(meta?.cid).toBe('158');
    expect(meta?.pvzId).toBe('MSQ12');
  });
});
