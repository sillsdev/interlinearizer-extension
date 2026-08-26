/// <reference types="jest" />

import { collatorForTag } from '../../utils/language-tags';

describe('collatorForTag', () => {
  it('collates under the tag it is given', () => {
    // Swedish sorts "ä" after "z", which the default locale does not, so the tag demonstrably
    // reached the collator rather than being dropped.
    expect(collatorForTag('sv').compare('ä', 'z')).toBeGreaterThan(0);
  });

  it('falls back to the default collation for a tag Intl rejects', () => {
    // Underscores instead of hyphens is the classic hand-typed tag, and `Intl` throws on it.
    expect(() => collatorForTag('en_US')).not.toThrow();
    expect(collatorForTag('en_US').compare('a', 'b')).toBeLessThan(0);
  });
});
