/** @file Shared component-test render helpers. */

import type { ReactNode } from 'react';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';

/**
 * Testing Library render options that wrap a subject in `AnalysisStoreProvider` with the default
 * analysis language ("und") used across component tests.
 */
export const withAnalysisStore = {
  wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return <AnalysisStoreProvider analysisLanguage="und">{children}</AnalysisStoreProvider>;
  },
};
