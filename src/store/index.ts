import { configureStore, type Middleware } from '@reduxjs/toolkit';
import { perfMark, perfMarksEnabled } from '../utils/perf-marks';
import analysisReducer, { type AnalysisState } from './analysisSlice';

/** Marks when each dispatch that changes the analysis began, so the render it causes can be timed. */
const markDispatches: Middleware<object, { analysis: AnalysisState }> =
  ({ getState }) =>
  (next) =>
  (action) => {
    if (!perfMarksEnabled()) return next(action);
    const before = getState().analysis.analysis;
    const startTime = performance.now();
    const result = next(action);
    if (getState().analysis.analysis !== before) perfMark('dispatch', undefined, startTime);
    return result;
  };

/**
 * Creates a Redux store scoped to a single analysis provider instance, optionally seeded from that
 * provider's props. Keeping the store local rather than global means each WebView, or nested
 * provider, has fully isolated state.
 */
export function createAnalysisStore(preloadedState?: { analysis: AnalysisState }) {
  return configureStore({
    reducer: { analysis: analysisReducer },
    preloadedState,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(markDispatches),
  });
}

/** The Redux store type returned by {@link createAnalysisStore}. */
export type AnalysisStore = ReturnType<typeof createAnalysisStore>;

/** Root state shape of an {@link AnalysisStore}. */
export type AnalysisRootState = ReturnType<AnalysisStore['getState']>;

/** Dispatch type of an {@link AnalysisStore}, used for typed `useDispatch` calls. */
export type AnalysisDispatch = AnalysisStore['dispatch'];
