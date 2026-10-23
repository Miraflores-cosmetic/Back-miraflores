/**
 * Sticky «непрочитанным» across tabs: localStorage + BroadcastChannel.
 * localStorage (не session) — cold-open вкладка с тем же origin видит suppress
 * и не POST /read. Не привязывать к panelVisible.
 * Хранит unreadGeneration для CAS /read на Nest.
 */

const STORAGE_PREFIX = 'miraflores.adminChat.suppressRead:';
const GEN_PREFIX = 'miraflores.adminChat.unreadGen:';
const BC_NAME = 'miraflores-admin-chat-suppress-read';

export type AdminChatSuppressReadMessage =
  | { type: 'set'; targetKey: string; unreadGeneration: number }
  | { type: 'clear'; targetKey: string };

function storageKey(targetKey: string): string {
  return `${STORAGE_PREFIX}${targetKey}`;
}

function genKey(targetKey: string): string {
  return `${GEN_PREFIX}${targetKey}`;
}

export function readAdminChatSuppressRead(targetKey: string): boolean {
  if (!targetKey || typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(storageKey(targetKey)) === '1';
  } catch {
    return false;
  }
}

export function readAdminChatUnreadGeneration(targetKey: string): number {
  if (!targetKey || typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(genKey(targetKey));
    if (raw == null || raw === '') return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function writeAdminChatUnreadGeneration(
  targetKey: string,
  generation: number,
): void {
  if (!targetKey || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(genKey(targetKey), String(Math.max(0, Math.floor(generation))));
  } catch {
    /* private mode */
  }
}

function writeSuppressFlag(targetKey: string, on: boolean): void {
  if (!targetKey || typeof localStorage === 'undefined') return;
  try {
    if (on) localStorage.setItem(storageKey(targetKey), '1');
    else localStorage.removeItem(storageKey(targetKey));
  } catch {
    /* private mode */
  }
}

let sharedBc: BroadcastChannel | null | undefined;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (sharedBc === undefined) {
    try {
      sharedBc = new BroadcastChannel(BC_NAME);
    } catch {
      sharedBc = null;
    }
  }
  return sharedBc ?? null;
}

export function publishAdminChatSuppressRead(msg: AdminChatSuppressReadMessage): void {
  if (msg.type === 'set') {
    writeSuppressFlag(msg.targetKey, true);
    writeAdminChatUnreadGeneration(msg.targetKey, msg.unreadGeneration);
  } else {
    writeSuppressFlag(msg.targetKey, false);
  }
  try {
    getBroadcastChannel()?.postMessage(msg);
  } catch {
    /* ignore */
  }
}

/** Subscribe to cross-tab suppress updates. Returns unsubscribe. */
export function subscribeAdminChatSuppressRead(
  onMessage: (msg: AdminChatSuppressReadMessage) => void,
): () => void {
  const bc = getBroadcastChannel();
  if (!bc) return () => undefined;
  const handler = (ev: MessageEvent) => {
    const data = ev.data as AdminChatSuppressReadMessage | null;
    if (!data || (data.type !== 'set' && data.type !== 'clear')) return;
    if (typeof data.targetKey !== 'string' || !data.targetKey) return;
    if (data.type === 'set' && typeof data.unreadGeneration !== 'number') return;
    onMessage(data);
  };
  bc.addEventListener('message', handler);
  return () => bc.removeEventListener('message', handler);
}
