/// <reference types="jest" />

import { formatTemplate, formatTemplateToArray } from '../../utils/format-template';

describe('formatTemplateToArray', () => {
  it('splits the template around a replaced placeholder', () => {
    expect(formatTemplateToArray('Hold {key} and click', { key: 1 })).toEqual([
      'Hold ',
      1,
      ' and click',
    ]);
  });

  it('keeps a replacement as its own value rather than a string', () => {
    const node = { kind: 'element' };
    expect(formatTemplateToArray('{phrase}', { phrase: node })).toEqual([node]);
  });

  it('leaves an unknown key as its own text', () => {
    expect(formatTemplateToArray('Gloss for {token}', {})).toEqual(['Gloss for ', 'token']);
  });

  it('returns a template with no placeholder as one part', () => {
    expect(formatTemplateToArray('No placeholder', { token: 'x' })).toEqual(['No placeholder']);
  });

  it('returns nothing for an empty template', () => {
    expect(formatTemplateToArray('', { token: 'x' })).toEqual([]);
  });
});

describe('formatTemplate', () => {
  it('joins every part into one string', () => {
    expect(formatTemplate('Remove {token} ({count})', { token: 'word', count: 2 })).toBe(
      'Remove word (2)',
    );
  });

  it('fills the same key wherever it repeats', () => {
    expect(formatTemplate('{token}/{token}', { token: 'a' })).toBe('a/a');
  });
});
