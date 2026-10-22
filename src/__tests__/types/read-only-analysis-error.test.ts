/// <reference types="jest" />

import { ReadOnlyAnalysisError } from '../../types/read-only-analysis-error';

describe('ReadOnlyAnalysisError', () => {
  it('is an Error named for itself, carrying its message', () => {
    const error = new ReadOnlyAnalysisError('import is read-only');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ReadOnlyAnalysisError');
    expect(error.message).toBe('import is read-only');
  });
});
