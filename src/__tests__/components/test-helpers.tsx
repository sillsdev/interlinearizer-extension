import { useLocalizedStrings } from '@papi/frontend/react';
import { TooltipProvider } from 'platform-bible-react';
import type { SenseRef } from 'interlinearizer';
import type { ResolvedSense } from 'interlinearizer/lexicon';
import type { ReactElement, ReactNode } from 'react';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { LexiconSensesProvider } from '../../components/LexiconSenses';
import { createLexiconRegistry, nullLexiconResolver } from '../../utils/lexicon-resolvers';
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
  // One record per distinct key list, held for the life of this stub. The real hook keeps resolved
  // data in state, so it hands back the same object on an unchanged render; a stub that rebuilt the
  // record every call would break any memo keyed on it and turn a render-count assertion into a
  // measurement of the stub rather than of the component.
  const records = new Map<string, Record<string, string>>();
  jest.mocked(useLocalizedStrings).mockImplementation((keys: readonly string[]) => {
    // A separator no localize key can contain, written as an escape because a literal NUL byte in
    // the source makes git and ripgrep treat this whole file as binary, hiding its diff and text.
    const cacheKey = keys.join('\0');
    let record = records.get(cacheKey);
    if (!record) {
      record = { ...Object.fromEntries(keys.map((k) => [k, k])), ...overrides };
      records.set(cacheKey, record);
    }
    return [record, false];
  });
}

/**
 * Testing Library render options that wrap a subject in `AnalysisStoreProvider` with the default
 * analysis language ("und") used across component tests.
 *
 * Supplies a {@link withTooltipProvider} wrapper too: a `Tooltip` throws without one, so a subject
 * that renders tooltips under an enclosing provider in the app needs it to mount in isolation at
 * all.
 */
export const withAnalysisStore = {
  wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return (
      <AnalysisStoreProvider analysisLanguage="und">
        {withTooltipProvider(children)}
      </AnalysisStoreProvider>
    );
  },
};

/**
 * Wraps a subject in the `TooltipProvider` the platform `Tooltip` requires, standing in for the one
 * the interlinear view supplies around the whole tree. A suite rendering a tooltipped component in
 * isolation needs it; without one the component throws exactly as it would in the app.
 */
export function withTooltipProvider(children: ReactNode): ReactElement {
  return <TooltipProvider>{children}</TooltipProvider>;
}

/** The authority of the lexicon {@link withLexicon} connects. */
export const TEST_LEXICON_AUTHORITY = 'test-lexicon';

/** A ref to the sense `senseId` in the lexicon {@link withLexicon} connects. */
export function testSenseRef(senseId: string): SenseRef {
  return { authority: TEST_LEXICON_AUTHORITY, senseId };
}

/**
 * One connected lexicon holding `senses`, keyed by sense id. A ref naming any other authority is
 * foreign to it.
 *
 * @returns The registry, and the lexicon's sense look-up so a test can see what was asked.
 */
export function stubLexiconRegistry(senses: Record<string, ResolvedSense> = {}) {
  const resolveSense = jest.fn(async ({ senseId }: SenseRef) => senses[senseId]);
  const registry = createLexiconRegistry([
    { ...nullLexiconResolver, authorities: [TEST_LEXICON_AUTHORITY], resolveSense },
  ]);
  return { registry, resolveSense };
}

/**
 * Wraps a subject in a {@link stubLexiconRegistry} lexicon holding `senses`, standing in for the
 * lexicon the interlinear view connects.
 *
 * @returns The wrapped subject, and the lexicon's sense look-up so a test can see what was asked.
 */
export function withLexicon(children: ReactNode, senses: Record<string, ResolvedSense> = {}) {
  const { registry, resolveSense } = stubLexiconRegistry(senses);
  return {
    ui: <LexiconSensesProvider registry={registry}>{children}</LexiconSensesProvider>,
    resolveSense,
  };
}

/** A {@link ViewOptions} object with every toggle set to `false`, for use as a test baseline. */
export const allFalseViewOptions: ViewOptions = {
  showMorphology: false,
  showFreeTranslation: false,
};

/** Every {@link TrackingResizeObserver} created since the suite last emptied it, newest last. */
export const resizeObserverInstances: TrackingResizeObserver[] = [];

/**
 * A ResizeObserver test double that records what it was pointed at, its callback, and its
 * disconnect state, and appends itself to {@link resizeObserverInstances}, so a test can fire a
 * simulated reflow on the observers watching one element.
 */
export class TrackingResizeObserver implements ResizeObserver {
  /** Whether {@link disconnect} has been called on this instance. */
  disconnected = false;

  /**
   * Elements this instance was pointed at. A view runs several observers at once, so a test picks
   * one by the element it watches rather than by creation order.
   */
  targets: Element[] = [];

  constructor(public callback: ResizeObserverCallback) {
    resizeObserverInstances.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }
}
