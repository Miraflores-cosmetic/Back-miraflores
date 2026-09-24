/** Нормализованное отображаемое имя (пустая строка → null). */
export function normalizeStaffDisplayName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isStaffDisplayNameDirty(
  draft: string,
  saved: string | null | undefined,
): boolean {
  return normalizeStaffDisplayName(draft) !== normalizeStaffDisplayName(saved ?? '');
}

export function formatStaffLastLogin(iso: string | null): string {
  if (!iso) return 'никогда';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function staffAvatarAltText(displayName: string | null | undefined, email: string | null | undefined): string {
  const name = displayName?.trim() || email?.trim();
  return name ? `Аватар: ${name}` : 'Аватар сотрудника';
}
