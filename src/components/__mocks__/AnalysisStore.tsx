
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AssignmentStatus, MorphemeAnalysis } from 'interlinearizer';
import type { ResolvedTokenAnalysis } from '../../utils/suggestion-engine';

type GlossMap = Record<string, string>;
type MockCtxValue = {
  glosses: GlossMap;
  dispatch: (tokenRef: string, surfaceText: string, value: string) => void;
  language: string;
};
const MockCtx = createContext<MockCtxValue>({
  glosses: {},
  dispatch: () => {},
  language: 'und',
});

/**
 * Test-only provider that seeds glosses from `initialAnalysis` and keeps them in local state,
 * forwarding updates to `onGlossChange` without depending on the real AnalysisStore.
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
 */
export function useGloss(tokenRef: string) {
  return useContext(MockCtx).glosses[tokenRef] ?? '';
}

/**
 * Returns the dispatch function that updates a token's gloss in mock context.
 */
export function useGlossDispatch() {
  return useContext(MockCtx).dispatch;
}

/** Empty morphemes array returned by {@link useMorphemes} when no breakdown exists. */
const EMPTY_MORPHEMES: readonly MorphemeAnalysis[] = [];

/**
 * Returns the morpheme breakdown for a token. Always returns an empty array in mock context.
 */
export function useMorphemes(_tokenRef: string): readonly MorphemeAnalysis[] {
  return EMPTY_MORPHEMES;
}

/**
 * Returns the BCP 47 analysis language mirroring the `analysisLanguage` prop passed to the mock
 * provider, or `'und'` outside a provider.
 */
export function useAnalysisLanguage(): string {
  return useContext(MockCtx).language;
}

/**
 * Returns a no-op dispatch for writing morpheme breakdowns in mock context.
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
 */
export function useMorphemeDeleteDispatch(): (tokenRef: string) => void {
  return () => {};
}

/**
 * Reports that a morpheme reset never loses glosses in mock context, so the editor takes its
 * unconfirmed path by default. Tests covering the confirm step mock this module member directly.
 */
export function useMorphemeResetLosesGlosses(): boolean {
  return false;
}

/**
 * Returns a no-op dispatch for writing morpheme glosses in mock context.
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
 */
export function useReportGlossEditing(_isEditing: boolean): void {}

/**
 * Returns the merged token analysis in mock context. The mock pool is empty, so it never derives
 * a suggestion — always `undefined`. Suggestion behavior is covered against the real store.
 */
export function useResolvedTokenAnalysis(
  _tokenRef: string,
  _surfaceText: string,
  _enabled?: boolean,
): ResolvedTokenAnalysis | undefined {
  return undefined;
}

/**
 * Returns the cleared-token suggestion preview in mock context. The mock pool is empty, so it never
 * previews a suggestion — always `undefined`. Clearing behavior is covered against the real store.
 */
export function useSuggestionAfterClearing(
  _tokenRef: string,
  _surfaceText: string,
  _enabled: boolean,
): ResolvedTokenAnalysis | undefined {
  return undefined;
}

/**
 * Returns whether suggestions should render in mock context — always `false`.
 */
export function useShowSuggestions(): boolean {
  return false;
}

/**
 * What {@link useAnalysisReadOnly} returns. Module state, so `resetMocks` does not clear it: a test
 * that sets it must reset it in `afterEach` via {@link __setMockAnalysisReadOnly}.
 */
let mockReadOnly = false;

/** Test-only setter for what {@link useAnalysisReadOnly} returns. */
export function __setMockAnalysisReadOnly(value: boolean): void {
  mockReadOnly = value;
}

/** Returns whether the analysis renders read-only in mock context; defaults to `false`. */
export function useAnalysisReadOnly(): boolean {
  return mockReadOnly;
}

/**
 * Returns a no-op dispatch for approving an analysis (accept / promote) in mock context.
 */
export function useApproveAnalysisDispatch(): (
  tokenRef: string,
  surfaceText: string,
  analysisId: string,
) => void {
  return () => {};
}
