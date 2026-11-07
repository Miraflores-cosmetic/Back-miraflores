/** Fill shareText placeholders {link} {code} (parity with Front). */
export function fillReferralShareText(
  template: string,
  opts: { link: string; code: string },
): string {
  const text = template || 'Закажи в Miraflores по моей ссылке: {link}';
  return text.split('{link}').join(opts.link).split('{code}').join(opts.code);
}
