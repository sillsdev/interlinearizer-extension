/// <reference types="jest" />

import { renderHook, waitFor } from '@testing-library/react';
import type { SenseRef } from 'interlinearizer';
import type { ReactNode } from 'react';
import {
  LexiconSensesProvider,
  useDisplayedGloss,
  WithoutLexiconSenses,
} from '../../components/LexiconSenses';
import { stubLexiconRegistry, testSenseRef } from './test-helpers';

const SENSES = { 's-1': { gloss: { en: 'water', fr: 'eau' } } };

/** Renders {@link useDisplayedGloss} inside a lexicon holding {@link SENSES}. */
function renderDisplayedGloss(gloss: string, senseRef: SenseRef | undefined, language = 'en') {
  const { registry, resolveSense } = stubLexiconRegistry(SENSES);
  const wrapper = ({ children }: Readonly<{ children: ReactNode }>) => (
    <LexiconSensesProvider registry={registry}>{children}</LexiconSensesProvider>
  );
  const rendered = renderHook(() => useDisplayedGloss(gloss, senseRef, language), { wrapper });
  return { ...rendered, resolveSense };
}

describe('useDisplayedGloss', () => {
  it('shows the stored gloss without asking the lexicon', () => {
    const { result, resolveSense } = renderDisplayedGloss('stored', testSenseRef('s-1'));

    expect(result.current).toEqual({ text: 'stored', fromLexicon: false });
    expect(resolveSense).not.toHaveBeenCalled();
  });

  it("shows the linked sense's gloss where none is stored", async () => {
    const { result } = renderDisplayedGloss('', testSenseRef('s-1'));

    await waitFor(() => expect(result.current).toEqual({ text: 'water', fromLexicon: true }));
  });

  it("shows the sense's gloss in the language asked for", async () => {
    const { result } = renderDisplayedGloss('', testSenseRef('s-1'), 'fr');

    await waitFor(() => expect(result.current.text).toBe('eau'));
  });

  it('shows nothing where the sense has no gloss in the language asked for', async () => {
    const { result, resolveSense } = renderDisplayedGloss('', testSenseRef('s-1'), 'de');

    await waitFor(() => expect(resolveSense).toHaveBeenCalled());
    expect(result.current).toEqual({ text: '', fromLexicon: false });
  });

  it('shows nothing for a link the lexicon has no sense for', async () => {
    const { result, resolveSense } = renderDisplayedGloss('', testSenseRef('gone'));

    await waitFor(() => expect(resolveSense).toHaveBeenCalled());
    expect(result.current).toEqual({ text: '', fromLexicon: false });
  });

  it('shows nothing for a foreign link, which never reaches the lexicon', async () => {
    const { result, resolveSense } = renderDisplayedGloss('', {
      authority: 'elsewhere',
      senseId: 's-1',
    });

    await waitFor(() => expect(result.current.text).toBe(''));
    expect(resolveSense).not.toHaveBeenCalled();
  });

  it('shows nothing for an analysis with neither a gloss nor a link', () => {
    const { result } = renderDisplayedGloss('', undefined);

    expect(result.current).toEqual({ text: '', fromLexicon: false });
  });

  it('shows nothing outside any lexicon', async () => {
    const { result } = renderHook(() => useDisplayedGloss('', testSenseRef('s-1'), 'en'));

    await waitFor(() => expect(result.current).toEqual({ text: '', fromLexicon: false }));
  });

  it('shows nothing beneath a lexicon-free subtree, even inside a lexicon', async () => {
    const { registry, resolveSense } = stubLexiconRegistry(SENSES);
    const wrapper = ({ children }: Readonly<{ children: ReactNode }>) => (
      <LexiconSensesProvider registry={registry}>
        <WithoutLexiconSenses>{children}</WithoutLexiconSenses>
      </LexiconSensesProvider>
    );
    const { result } = renderHook(() => useDisplayedGloss('', testSenseRef('s-1'), 'en'), {
      wrapper,
    });

    await waitFor(() => expect(result.current).toEqual({ text: '', fromLexicon: false }));
    expect(resolveSense).not.toHaveBeenCalled();
  });

  it('asks again once a different lexicon is connected', async () => {
    const first = stubLexiconRegistry({ 's-1': { gloss: { en: 'water' } } });
    const second = stubLexiconRegistry({ 's-1': { gloss: { en: 'rain' } } });
    let { registry } = first;
    const wrapper = ({ children }: Readonly<{ children: ReactNode }>) => (
      <LexiconSensesProvider registry={registry}>{children}</LexiconSensesProvider>
    );
    const { result, rerender } = renderHook(
      () => useDisplayedGloss('', testSenseRef('s-1'), 'en'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.text).toBe('water'));

    registry = second.registry;
    rerender();

    await waitFor(() => expect(result.current.text).toBe('rain'));
    expect(first.resolveSense).toHaveBeenCalledTimes(1);
  });
});
