/** Сброс ISR главной после правок Hero / наборов / промо в админке. */
export async function revalidateHomeStorefront(): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/revalidate-hero', {
      method: 'POST',
      credentials: 'same-origin',
    });
    return res.ok;
  } catch {
    return false;
  }
}
