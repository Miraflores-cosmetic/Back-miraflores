/** Синхронно с backend address-clarification.ts */
export const ADDRESS_CLARIFICATION_MARKER = '__JCOS_ADDRESS_CLARIFICATION__=1';

const CLARIFICATION_HINT_RE = /тип\s+доставки:\s*уточнит\s+оператор/i;

export function stripAddressClarificationFromComment(
  comment: string | null | undefined,
): string {
  if (!comment?.trim()) return '';
  const lines = comment.split('\n');
  const kept = lines.filter((line) => {
    if (line.includes(ADDRESS_CLARIFICATION_MARKER)) return false;
    if (CLARIFICATION_HINT_RE.test(line)) return false;
    return true;
  });
  return kept.join('\n').trimEnd();
}
