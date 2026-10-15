import { configureStore, type Middleware } from '@reduxjs/toolkit';
import { perfMark } from '../utils/perf-marks';
import analysisReducer, { type AnalysisState } from './analysisSlice';

/** Marks each dispatch on the performance timeline, so the render it causes can be timed. */
const markDispatches: Middleware = () => (next) => (action) => {
  perfMark('dispatch');
  return next(action);
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
