export async function readUpstreamJsonErrorMessage(res: Response): Promise<string> {
  const fallback = res.statusText || `HTTP ${res.status}`;
  const text = await res.text().catch(() => '');
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  try {
    const j = JSON.parse(trimmed) as { message?: unknown };
    if (typeof j.message === 'string' && j.message.trim()) return j.message.trim();
    if (Array.isArray(j.message) && j.message.length > 0) {
      return j.message.map(String).join(', ');
    }
  } catch {
    return trimmed.slice(0, 280);
  }
  return trimmed.slice(0, 280) || fallback;
}
