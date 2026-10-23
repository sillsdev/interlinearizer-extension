/// <reference types="jest" />

import { jsonCopy } from '../../utils/json-copy';

describe('jsonCopy', () => {
  it('copies a JSON-plain value deeply, sharing nothing with it', () => {
    const value = { gloss: { en: 'and' }, morphemes: [{ form: 'and' }] };

    const copy = jsonCopy(value);
    copy.gloss.en = 'changed';
    copy.morphemes[0].form = 'changed';

    expect(copy).not.toBe(value);
    expect(value).toStrictEqual({ gloss: { en: 'and' }, morphemes: [{ form: 'and' }] });
  });
});
