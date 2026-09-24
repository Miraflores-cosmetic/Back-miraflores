export function orderChatLocalDayKey(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatOrderChatDaySeparatorLabel(
  iso: string,
  listLocale: string,
  now: Date = new Date(),
): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';

  const msgDayStart = startOfLocalDay(parsed);
  const todayStart = startOfLocalDay(now.getTime());
  const diffDays = Math.round((todayStart - msgDayStart) / 86_400_000);

  const low = listLocale.toLowerCase();
  const isZh = low.startsWith('zh');

  if (diffDays === 0) return isZh ? '今天' : 'Сегодня';
  if (diffDays === 1) return isZh ? '昨天' : 'Вчера';
  if (diffDays === 2) return isZh ? '前天' : 'Позавчера';

  return new Date(parsed).toLocaleDateString(listLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
