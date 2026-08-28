import { useLocalizedStrings } from '@papi/frontend/react';
import { TooltipProvider } from 'platform-bible-react';
import type { ReactElement, ReactNode } from 'react';
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

/** A {@link ViewOptions} object with every toggle set to `false`, for use as a test baseline. */
export const allFalseViewOptions: ViewOptions = {
  hideInactiveLinkButtons: false,
  simplifyPhrases: false,
  showMorphology: false,
  showFreeTranslation: false,
  showVerseGutter: false,
};
