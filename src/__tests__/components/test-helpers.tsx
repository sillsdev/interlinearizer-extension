/** @file Shared component-test render helpers. */

import type { ReactNode } from 'react';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';

/**
 * Testing Library render options that wrap a subject in `AnalysisStoreProvider` with the default
 * analysis language ("und") used across component tests.
 *
 * @returns An object with a `wrapper` function that accepts `{ children }` and returns the children
 *   wrapped in an `AnalysisStoreProvider` configured with `analysisLanguage="und"`.
 */
export const withAnalysisStore = {
  wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return <AnalysisStoreProvider analysisLanguage="und">{children}</AnalysisStoreProvider>;
  },
};
