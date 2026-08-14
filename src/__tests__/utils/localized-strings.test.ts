/// <reference types="jest" />

import { resolvedOrEmpty, tooltipContentOrUndefined } from '../../utils/localized-strings';

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

describe('tooltipContentOrUndefined', () => {
  it('returns undefined for the empty string an unresolved key resolves to', () => {
    expect(tooltipContentOrUndefined('')).toBeUndefined();
  });

  it('returns undefined for the empty array an empty hint formats to', () => {
    expect(tooltipContentOrUndefined([])).toBeUndefined();
  });

  it('passes a resolved string through unchanged', () => {
    expect(tooltipContentOrUndefined('Join with the previous segment')).toBe(
      'Join with the previous segment',
    );
  });

  it('passes a formatted hint through unchanged', () => {
    const parts = ['Hold ', undefined, ' and click between words to split'];
    expect(tooltipContentOrUndefined(parts)).toBe(parts);
  });
});
