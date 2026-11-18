/// <reference types="jest" />

import { jsonCopy } from '../../utils/json-copy';

function original() {
  return {
    gloss: { en: 'and' },
    morphemes: [{ form: 'and' }],
    confidence: 0.5,
    morphemesStale: false,
    // eslint-disable-next-line no-null/no-null -- JSON carries null
    pos: null,
  };
}

describe('jsonCopy', () => {
  it('copies a JSON-plain value deeply, sharing nothing with it', () => {
    const value = original();

    const copy = jsonCopy(value);
    copy.gloss.en = 'changed';
    copy.morphemes[0].form = 'changed';

    expect(copy).not.toBe(value);
    expect(copy).toStrictEqual({
      ...original(),
      gloss: { en: 'changed' },
      morphemes: [{ form: 'changed' }],
    });
    expect(value).toStrictEqual(original());
  });

  it('keeps a `__proto__` key as an own property, leaving the prototype alone', () => {
    const value: unknown = JSON.parse('{"__proto__":{"gloss":"and"}}');

    const copy: unknown = jsonCopy(value);

    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(copy, '__proto__')?.value).toStrictEqual({
      gloss: 'and',
    });
  });
});
