/// <reference types="jest" />

import { LinkedAnalysisDeleteError } from '../../types/linked-analysis-delete-error';

describe('LinkedAnalysisDeleteError', () => {
  it('names the analyses that the kept links name', () => {
    const error = new LinkedAnalysisDeleteError(['ta-1', 'pa-2']);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LinkedAnalysisDeleteError');
    expect(error.analysisIds).toStrictEqual(['ta-1', 'pa-2']);
    expect(error.message).toContain('ta-1, pa-2');
  });
});
