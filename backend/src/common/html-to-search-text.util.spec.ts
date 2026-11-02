import { describe, expect, it } from 'vitest';
import {
  buildProductContentSearchText,
  htmlToSearchText,
  isHtmlNoiseQuery,
} from './html-to-search-text.util';

describe('htmlToSearchText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(htmlToSearchText('<p>Ретинол <strong>0.3%</strong></p>')).toBe(
      'Ретинол 0.3%',
    );
  });

  it('null / empty → null', () => {
    expect(htmlToSearchText(null)).toBeNull();
    expect(htmlToSearchText('')).toBeNull();
    expect(htmlToSearchText('   ')).toBeNull();
    expect(htmlToSearchText('<p></p>')).toBeNull();
  });

  it('decodes common entities', () => {
    expect(htmlToSearchText('A&nbsp;&amp;&nbsp;B')).toBe('A & B');
  });
});

describe('buildProductContentSearchText', () => {
  it('joins composition + description + actionEffect', () => {
    expect(
      buildProductContentSearchText({
        compositionHtml: '<p>ретинол</p>',
        descriptionHtml: '<p>для кожи</p>',
        actionEffectHtml: null,
      }),
    ).toBe('ретинол\nдля кожи');
  });
});

describe('isHtmlNoiseQuery', () => {
  it('flags short HTML tokens', () => {
    expect(isHtmlNoiseQuery('div')).toBe(true);
    expect(isHtmlNoiseQuery('HREF')).toBe(true);
    expect(isHtmlNoiseQuery('span')).toBe(true);
  });

  it('allows ingredient queries', () => {
    expect(isHtmlNoiseQuery('ретинол')).toBe(false);
    expect(isHtmlNoiseQuery('cream')).toBe(false);
  });
});
