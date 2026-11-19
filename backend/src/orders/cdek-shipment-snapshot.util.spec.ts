import { describe, expect, it } from 'vitest';
import {
  cdekShipmentPersistDirty,
  jsonSnapshotEqual,
} from './cdek-shipment-snapshot.util';

describe('cdek-shipment-snapshot.util', () => {
  it('jsonSnapshotEqual для одинакового JSON', () => {
    expect(jsonSnapshotEqual({ a: 1 }, { a: 1 })).toBe(true);
  });

  it('cdekShipmentPersistDirty: трек совпадает, raw тот же → не писать', () => {
    const raw = { entity: { cdek_number: '1' } };
    expect(
      cdekShipmentPersistDirty({
        apiTrack: '1100',
        dbTrack: '1100',
        remoteRaw: raw,
        dbRaw: raw,
      }).any,
    ).toBe(false);
  });

  it('cdekShipmentPersistDirty: raw изменился', () => {
    expect(
      cdekShipmentPersistDirty({
        apiTrack: '1100',
        dbTrack: '1100',
        remoteRaw: { entity: { n: 2 } },
        dbRaw: { entity: { n: 1 } },
      }).rawChanged,
    ).toBe(true);
  });
});