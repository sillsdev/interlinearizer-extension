/** @file Unit tests for utils/localized-strings.ts. */
/// <reference types="jest" />

import { resolvedOrEmpty } from '../../utils/localized-strings';

describe('resolvedOrEmpty', () => {
  it('returns an empty string for an unresolved %…% key', () => {
    expect(resolvedOrEmpty('%interlinearizer_glossInput_placeholder%')).toBe('');
  });

  it('returns a resolved localized string unchanged', () => {
    expect(resolvedOrEmpty('gloss')).toBe('gloss');
  });

  it('does not treat a string that merely contains a percent sign as a key', () => {
    expect(resolvedOrEmpty('50% complete')).toBe('50% complete');
  });
});
