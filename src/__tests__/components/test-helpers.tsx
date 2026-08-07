import { useLocalizedStrings } from '@papi/frontend/react';
import type { ReactNode } from 'react';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { ViewOptions } from '../../types/view-options';

/**
 * Stubs {@link useLocalizedStrings} to echo each requested key back as its own value, so components
 * that interpolate a localized string render something deterministic without the test having to
 * enumerate every key it touches, and so suites query controls by the stable localize key rather
 * than by English text a copy edit could change. `resetMocks` clears the hook's implementation
 * before every test, so call this from `beforeEach`.
 *
 * @param overrides - Resolved values layered over the key-as-value base, for the rare test that
 *   distinguishes a resolved string from an unresolved key.
 */
export function mockKeyAsValueLocalizedStrings(overrides: Record<string, string> = {}): void {
  jest
    .mocked(useLocalizedStrings)
    .mockImplementation((keys: readonly string[]) => [
      { ...Object.fromEntries(keys.map((k) => [k, k])), ...overrides },
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
