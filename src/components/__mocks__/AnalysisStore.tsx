/** @file Manual mock for AnalysisStore — reactive useState-based stub so AnalysisStore.tsx stays out of test scope. */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AssignmentStatus } from 'interlinearizer';

type GlossMap = Record<string, string>;
type MockCtxValue = {
  glosses: GlossMap;
  dispatch: (tokenRef: string, surfaceText: string, value: string) => void;
};
const MockCtx = createContext<MockCtxValue>({ glosses: {}, dispatch: () => {} });

/**
 * Test-only provider that seeds glosses from `initialAnalysis` and keeps them in local state,
 * forwarding updates to `onGlossChange` without depending on the real AnalysisStore.
 *
 * @param props - Same surface props as the real `AnalysisStoreProvider`.
 * @returns A React element wrapping `children` in the mock context.
 */
export function AnalysisStoreProvider({
  children,
  initialAnalysis,
  analysisLanguage,
  onGlossChange,
}: Readonly<{
  children: ReactNode;
  initialAnalysis?: {
    tokenAnalyses: { id: string; gloss?: GlossMap }[];
    tokenAnalysisLinks: {
      analysisId: string;
      status: AssignmentStatus;
      token: { tokenRef: string };
    }[];
  };
  analysisLanguage: string;
  onGlossChange?: (tokenRef: string, value: string) => void;
}>) {
  const byId = new Map((initialAnalysis?.tokenAnalyses ?? []).map((ta) => [ta.id, ta]));
  const seed: GlossMap = (initialAnalysis?.tokenAnalysisLinks ?? [])
    .filter((link) => link.status === 'approved')
    .reduce((acc, link) => {
      const gloss = byId.get(link.analysisId)?.gloss?.[analysisLanguage];
      return gloss === undefined ? acc : { ...acc, [link.token.tokenRef]: gloss };
    }, {});
  const [glosses, setGlosses] = useState<GlossMap>(seed);
  const dispatch = useCallback(
    (tokenRef: string, _surfaceText: string, value: string) => {
      setGlosses((prev) => ({ ...prev, [tokenRef]: value }));
      onGlossChange?.(tokenRef, value);
    },
    [onGlossChange],
  );
  const ctx = useMemo(() => ({ glosses, dispatch }), [glosses, dispatch]);
  return <MockCtx value={ctx}>{children}</MockCtx>;
}

/**
 * Returns the committed gloss for a token, or an empty string if none is set.
 *
 * @param tokenRef - The token reference key.
 * @returns The current gloss string from mock context.
 */
export function useGloss(tokenRef: string) {
  return useContext(MockCtx).glosses[tokenRef] ?? '';
}

/**
 * Returns the dispatch function that updates a token's gloss in mock context.
 *
 * @returns The mock dispatch function.
 */
export function useGlossDispatch() {
  return useContext(MockCtx).dispatch;
}
