/** @file Shared component-test render helpers. */

import type { ReactNode } from 'react';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { ViewOptions } from '../../types/view-options';

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
