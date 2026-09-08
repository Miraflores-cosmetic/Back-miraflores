const GUEST_KEY = 'miraflores.guest.v1';
const LEGACY_GUEST_KEY = 'jcos.guest.v1';

/**
 * Тот же ключ, что у Vite Front (`apiClient.getOrCreateGuestId`),
 * иначе checkout на Front + register на Admin не совпадут по guestId
 * (claim тогда идёт только по email).
 */
export function getOrCreateGuestId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id =
      window.localStorage.getItem(GUEST_KEY)?.trim() ||
      window.localStorage.getItem(LEGACY_GUEST_KEY)?.trim() ||
      '';
    if (id && !window.localStorage.getItem(GUEST_KEY)) {
      window.localStorage.setItem(GUEST_KEY, id);
      window.localStorage.removeItem(LEGACY_GUEST_KEY);
    }
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `g-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  } catch {
    return `g-${Date.now()}`;
  }
}
