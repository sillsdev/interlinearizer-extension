import { useLocalizedStrings } from '@papi/frontend/react';
import type { ReactNode } from 'react';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { ViewOptions } from '../../types/view-options';

/**
 * Stubs {@link useLocalizedStrings} to echo each requested key back as its own value, so components
 * that interpolate a localized string render something deterministic without the test having to
 * enumerate every key it touches. Call from `beforeEach`.
 */
export function mockKeyAsValueLocalizedStrings(): void {
  jest
    .mocked(useLocalizedStrings)
    .mockImplementation((keys: readonly string[]) => [
      Object.fromEntries(keys.map((k) => [k, k])),
      false,
    ]);
}

/**
 * Testing Library render options that wrap a subject in `AnalysisStoreProvider` with the default
 * analysis language ("und") used across component tests.
 */
export const withAnalysisStore = {
  wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return <AnalysisStoreProvider analysisLanguage="und">{children}</AnalysisStoreProvider>;
  },
};

/** A {@link ViewOptions} object with every toggle set to `false`, for use as a test baseline. */
export const allFalseViewOptions: ViewOptions = {
  hideInactiveLinkButtons: false,
  simplifyPhrases: false,
  showMorphology: false,
  showFreeTranslation: false,
  showVerseGutter: false,
};
