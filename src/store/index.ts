import { configureStore } from '@reduxjs/toolkit';
import analysisReducer, { type AnalysisState } from './analysisSlice';

/**
 * Creates a Redux store scoped to one `AnalysisStoreProvider` instance. Keeping the store local
 * rather than global means each WebView (or nested provider) has fully isolated state.
 *
 * @param preloadedState - Optional initial state, typically used to seed `initialAnalysis` and
 *   `analysisLanguage` from the provider props.
 * @returns A configured Redux store with the analysis reducer mounted at `state.analysis`.
 */
export function createAnalysisStore(preloadedState?: { analysis: AnalysisState }) {
  return configureStore({
    reducer: { analysis: analysisReducer },
    preloadedState,
  });
}

/** The Redux store type returned by {@link createAnalysisStore}. */
export type AnalysisStore = ReturnType<typeof createAnalysisStore>;

/** Root state shape of an {@link AnalysisStore}. */
export type AnalysisRootState = ReturnType<AnalysisStore['getState']>;

/** Dispatch type of an {@link AnalysisStore}, used for typed `useDispatch` calls. */
export type AnalysisDispatch = AnalysisStore['dispatch'];
