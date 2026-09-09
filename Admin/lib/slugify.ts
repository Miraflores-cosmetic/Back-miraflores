/** Транслит + kebab для slug (кириллица → латиница). Совпадает с backend catalog/slug.util. */
const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(input: string): string {
  const lower = input.trim().toLowerCase();
  let out = '';
  for (const ch of lower) {
    if (MAP[ch] !== undefined) out += MAP[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/\s|_|\.|\/|,|;|:/.test(ch)) out += '-';
    else if (ch === '-') out += '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'item';
}
