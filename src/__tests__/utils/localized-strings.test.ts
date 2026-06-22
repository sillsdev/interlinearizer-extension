/** @file Unit tests for utils/localized-strings.ts. */
/// <reference types="jest" />

import { resolvedOrEmpty } from '../../utils/localized-strings';

describe('resolvedOrEmpty', () => {
  it('returns an empty string for an unresolved %…% key', () => {
    expect(resolvedOrEmpty('%interlinearizer_glossInput_placeholder%')).toBe('');
  });

  it('does not treat a string with only an initial percent sign as a key', () => {
    expect(resolvedOrEmpty('% interest?')).toBe('% interest?');
  });

  it('does not treat a string with only a final percent sign as a key', () => {
    expect(resolvedOrEmpty('complete: 50%')).toBe('complete: 50%');
  });
});
