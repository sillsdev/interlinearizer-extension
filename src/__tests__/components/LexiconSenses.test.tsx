/// <reference types="jest" />

import { act, renderHook, waitFor } from '@testing-library/react';
import type { SenseRef } from 'interlinearizer';
import type { ReactNode } from 'react';
import {
  LexiconSensesProvider,
  useDisplayedGloss,
  useLinkedGloss,
} from '../../components/LexiconSenses';
import { stubLexiconRegistry, testSenseRef } from './test-helpers';

const SENSES = {
  's-1': { gloss: { en: 'water', fr: 'eau' } },
  's-padded': { gloss: { en: ' water ' } },
};

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

/** Renders {@link useLinkedGloss} inside a lexicon holding {@link SENSES}. */
function renderLinkedGloss(gloss: string, senseRef: SenseRef | undefined, language = 'en') {
  const { registry, resolveSense } = stubLexiconRegistry(SENSES);
  const wrapper = ({ children }: Readonly<{ children: ReactNode }>) => (
    <LexiconSensesProvider registry={registry}>{children}</LexiconSensesProvider>
  );
  const rendered = renderHook(() => useLinkedGloss(gloss, senseRef, language), { wrapper });
  return { ...rendered, resolveSense };
}

describe('useLinkedGloss', () => {
  it('asks for the sense even where a gloss is stored', async () => {
    const { result } = renderLinkedGloss('water', testSenseRef('s-1'));

    await waitFor(() => expect(result.current.senseGloss).toBe('water'));
    expect(result.current).toMatchObject({ text: 'water', fromLexicon: false, differs: false });
  });

  it("reports a stored gloss that differs from the sense's", async () => {
    const { result } = renderLinkedGloss('liquid', testSenseRef('s-1'));

    await waitFor(() => expect(result.current.differs).toBe(true));
    expect(result.current).toMatchObject({ text: 'liquid', senseGloss: 'water' });
  });

  it('ignores whitespace around the stored gloss when comparing them', async () => {
    const { result } = renderLinkedGloss(' water ', testSenseRef('s-1'));

    await waitFor(() => expect(result.current.senseGloss).toBe('water'));
    expect(result.current.differs).toBe(false);
  });

  it("ignores whitespace around the sense's gloss when comparing them", async () => {
    const { result } = renderLinkedGloss('water', testSenseRef('s-padded'));

    await waitFor(() => expect(result.current.senseGloss).toBe(' water '));
    expect(result.current.differs).toBe(false);
  });

  it("shows the sense's gloss where none is stored, with nothing to differ from", async () => {
    const { result } = renderLinkedGloss('', testSenseRef('s-1'));

    await waitFor(() => expect(result.current.fromLexicon).toBe(true));
    expect(result.current).toMatchObject({ text: 'water', differs: false });
  });

  it('reports no difference where the sense has no gloss in the language asked for', async () => {
    const { result, resolveSense } = renderLinkedGloss('Wasser', testSenseRef('s-1'), 'de');

    await waitFor(() => expect(resolveSense).toHaveBeenCalled());
    // The sense resolves to no gloss here, just as a pending one shows none, so wait out the lookup.
    await act(async () => {
      await resolveSense.mock.results[0].value;
    });
    expect(result.current).toMatchObject({ senseGloss: '', differs: false });
  });

  it('asks for nothing without a link', () => {
    const { result, resolveSense } = renderLinkedGloss('water', undefined);

    expect(result.current).toEqual({
      text: 'water',
      fromLexicon: false,
      senseGloss: '',
      differs: false,
    });
    expect(resolveSense).not.toHaveBeenCalled();
  });
});
