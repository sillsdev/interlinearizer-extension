/// <reference types="jest" />

import { createAnalysisStore } from '../../store';
import { setAnalysisLanguage, writeGloss } from '../../store/analysisSlice';
import { perfMark, perfMarksEnabled } from '../../utils/perf-marks';

jest.mock('../../utils/perf-marks');

describe('createAnalysisStore', () => {
  it('marks when a dispatch that changes the analysis began', () => {
    jest.mocked(perfMarksEnabled).mockReturnValue(true);
    jest.spyOn(performance, 'now').mockReturnValue(40);
    const store = createAnalysisStore();

    store.dispatch(writeGloss('tok-1', 'word', 'hi'));

    expect(perfMark).toHaveBeenCalledWith('dispatch', undefined, 40);
  });

  it('marks no dispatch that leaves the analysis unchanged', () => {
    jest.mocked(perfMarksEnabled).mockReturnValue(true);
    const store = createAnalysisStore();

    store.dispatch(setAnalysisLanguage('fr'));

    expect(perfMark).not.toHaveBeenCalled();
  });

  it('marks nothing while marks are off', () => {
    const store = createAnalysisStore();

    store.dispatch(writeGloss('tok-1', 'word', 'hi'));

    expect(perfMark).not.toHaveBeenCalled();
  });
});
