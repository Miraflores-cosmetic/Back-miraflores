import type { ReactNode } from 'react';

const URL_RE =
  /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)}\]]/gi;

export function linkifyChatMessageContent(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const href = match[0];
    nodes.push(
      <a key={`${idx}-${href}`} href={href} target="_blank" rel="noopener noreferrer">
        {href}
      </a>,
    );
    last = idx + href.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length > 0 ? nodes : [text];
}
