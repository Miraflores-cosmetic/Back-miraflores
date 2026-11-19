/** Сравнение JSON-снапшота СДЭК без лишних UPDATE shipment. */
export function jsonSnapshotEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function cdekShipmentPersistDirty(opts: {
  apiTrack: string | null;
  dbTrack: string;
  remoteRaw: unknown;
  dbRaw: unknown;
}): { trackChanged: boolean; rawChanged: boolean; any: boolean } {
  const dbTrack = opts.dbTrack.trim();
  const apiTrack = opts.apiTrack?.trim() ?? '';
  const trackChanged = Boolean(apiTrack && apiTrack !== dbTrack);
  const rawChanged =
    opts.remoteRaw != null &&
    !jsonSnapshotEqual(opts.dbRaw ?? null, opts.remoteRaw);
  return { trackChanged, rawChanged, any: trackChanged || rawChanged };
}