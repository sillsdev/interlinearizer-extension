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

  it('leaves a key naming an inherited property as its own text', () => {
    expect(formatTemplateToArray('Gloss for {toString}', {})).toEqual(['Gloss for ', 'toString']);
  });

  it('returns a template with no placeholder as one part', () => {
    expect(formatTemplateToArray('No placeholder', { token: 'x' })).toEqual(['No placeholder']);
  });

  it('returns nothing for an empty template', () => {
    expect(formatTemplateToArray('', { token: 'x' })).toEqual([]);
  });

  it('keeps an escaped brace pair as literal text beside a real replacement', () => {
    expect(formatTemplateToArray('Use \\{token\\}, then {token}', { token: 'word' })).toEqual([
      'Use {token}, then ',
      'word',
    ]);
  });

  it('joins the text either side of an escaped brace into one part', () => {
    expect(formatTemplateToArray('\\{token\\}', { token: 'word' })).toEqual(['{token}']);
  });

  it('leaves an escaped closing brace out of the key it follows', () => {
    expect(formatTemplateToArray('{token\\}', { token: 'word' })).toEqual(['{token}']);
  });

  it('keeps an escaped opening brace out of the key it follows', () => {
    expect(formatTemplateToArray('{a\\{b}', { a: 'word' })).toEqual(['{a{b}']);
  });

  it('closes a placeholder on the first unescaped brace after an escaped one', () => {
    expect(formatTemplateToArray('{a\\}b}', { a: 'word' })).toEqual(['{a}b}']);
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

  it('leaves a backslash that precedes anything but a brace alone', () => {
    expect(formatTemplate('a \\\\ b \\n {token}', { token: 'w' })).toBe('a \\\\ b \\n w');
  });

  it('leaves a trailing backslash alone', () => {
    expect(formatTemplate('ends with \\', {})).toBe('ends with \\');
  });

  it('keeps an escaped brace around an unknown key', () => {
    expect(formatTemplate('\\{unknown\\}', {})).toBe('{unknown}');
  });
});
