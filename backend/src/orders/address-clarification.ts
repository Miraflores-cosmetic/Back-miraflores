/**
 * Marker in shippingAddress.comment / streetAddress2.
 * Must match Front `addressClarification.ts` (no shared package — drift only on
 * manual edit of this string on one side).
 */
export const ADDRESS_CLARIFICATION_MARKER = '__JCOS_ADDRESS_CLARIFICATION__=1';

const SYNTHETIC_ADDRESS_RE = /адрес\s+уточнит\s+оператор/i;
const CLARIFICATION_HINT_RE = /тип\s+доставки:\s*уточнит\s+оператор/i;

/** True if comment/street2 carries the clarification marker. */
export function isClarificationComment(
  comment: string | null | undefined,
): boolean {
  return (comment || '').includes(ADDRESS_CLARIFICATION_MARKER);
}

/**
 * Evidence that the client really chose «уточнит оператор», not just spoofed the boolean.
 * Accept marker in comment and/or synthetic street line.
 */
export function hasAddressClarificationEvidence(input: {
  comment?: string | null;
  address?: string | null;
}): boolean {
  const address = (input.address || '').trim();
  if (isClarificationComment(input.comment)) return true;
  if (SYNTHETIC_ADDRESS_RE.test(address)) return true;
  return false;
}

export function buildAddressClarificationComment(existing?: string | null): string {
  const raw = (existing || '').trim();
  if (isClarificationComment(raw)) return raw;
  if (!raw) {
    return `Тип доставки: Уточнит оператор.\n${ADDRESS_CLARIFICATION_MARKER}`;
  }
  return `${raw}\n${ADDRESS_CLARIFICATION_MARKER}`;
}

/** Убрать marker / «уточнит оператор» из comment (JCOS meta в первой строке сохраняем). */
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
