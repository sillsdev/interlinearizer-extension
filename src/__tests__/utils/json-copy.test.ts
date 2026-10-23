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
});
