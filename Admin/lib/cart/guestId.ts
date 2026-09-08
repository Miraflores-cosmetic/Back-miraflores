const GUEST_KEY = 'miraflores.guest.v1';

/** Совпадает с Vite Front (`apiClient.getOrCreateGuestId`). */
export function getOrCreateGuestId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.localStorage.getItem(GUEST_KEY)?.trim() || '';
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
