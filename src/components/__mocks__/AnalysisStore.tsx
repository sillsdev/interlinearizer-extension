/** @file Manual mock for AnalysisStore — reactive useState-based stub so AnalysisStore.tsx stays out of test scope. */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AssignmentStatus, MorphemeAnalysis } from 'interlinearizer';

type GlossMap = Record<string, string>;
type MockCtxValue = {
  glosses: GlossMap;
  dispatch: (tokenRef: string, surfaceText: string, value: string) => void;
  language: string;
};
const MockCtx = createContext<MockCtxValue>({ glosses: {}, dispatch: () => {}, language: 'und' });

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
  const ctx = useMemo(
    () => ({ glosses, dispatch, language: analysisLanguage }),
    [glosses, dispatch, analysisLanguage],
  );
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

/** Empty morphemes array returned by {@link useMorphemes} when no breakdown exists. */
const EMPTY_MORPHEMES: readonly MorphemeAnalysis[] = [];

/**
 * Returns the morpheme breakdown for a token. Always returns an empty array in mock context.
 *
 * @param _tokenRef - The token reference key (unused in mock).
 * @returns An empty readonly morpheme array.
 */
export function useMorphemes(_tokenRef: string): readonly MorphemeAnalysis[] {
  return EMPTY_MORPHEMES;
}

/**
 * Returns the analysis language string from mock context, mirroring the `analysisLanguage` prop
 * passed to the mock provider.
 *
 * @returns The BCP 47 tag from mock context (defaults to `'und'` outside a provider).
 */
export function useAnalysisLanguage(): string {
  return useContext(MockCtx).language;
}

/**
 * Returns a no-op dispatch for writing morpheme breakdowns in mock context.
 *
 * @returns A no-op function matching the real signature.
 */
export function useMorphemeBreakdownDispatch(): (
  tokenRef: string,
  surfaceText: string,
  forms: string[],
  writingSystem: string,
) => void {
  return () => {};
}

/**
 * Returns a no-op dispatch for deleting morpheme breakdowns in mock context.
 *
 * @returns A no-op function matching the real signature.
 */
export function useMorphemeDeleteDispatch(): (tokenRef: string) => void {
  return () => {};
}

/**
 * Returns a no-op dispatch for writing morpheme glosses in mock context.
 *
 * @returns A no-op function matching the real signature.
 */
export function useMorphemeGlossDispatch(): (
  tokenRef: string,
  morphemeId: string,
  value: string,
) => void {
  return () => {};
}

/**
 * No-op stand-in for the real pending-edits reporter. The mock has no provider-level editing
 * accounting, so it simply ignores the flag.
 *
 * @param _isEditing - Whether the input currently holds uncommitted text (unused in mock).
 */
export function useReportGlossEditing(_isEditing: boolean): void {}
