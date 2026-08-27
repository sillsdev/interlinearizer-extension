/// <reference types="jest" />

import type { Pt9Lexicon } from 'platform-scripture';
import { createPt9GlossSource } from '../../../converters/pt9/pt9GlossSource';

/** A lexicon whose entries exercise every resolution path. */
const LEXICON: Pt9Lexicon = {
  language: 'en',
  entries: [
    {
      id: 'Word:hello',
      type: 'Word',
      form: 'hello',
      homograph: 1,
      senses: [
        {
          id: 'S1',
          glosses: [
            { language: 'EN', text: 'greeting' },
            { language: 'fr', text: 'salut' },
          ],
        },
        { id: 'S2', glosses: [{ language: 'fr', text: 'coucou' }] },
      ],
    },
    {
      id: 'Word:empty',
      type: 'Word',
      form: 'empty',
      homograph: 1,
      senses: [{ id: 'S3', glosses: [{ language: 'en', text: '' }] }],
    },
    {
      id: 'Word:multi',
      type: 'Word',
      form: 'multi',
      homograph: 1,
      senses: [
        { id: 'S4', glosses: [{ language: 'en', text: 'one' }] },
        { id: 'S5', glosses: [{ language: 'en', text: 'two' }] },
      ],
    },
    {
      id: 'Word:idless',
      type: 'Word',
      form: 'idless',
      homograph: 1,
      senses: [{ glosses: [{ language: 'en', text: 'bare' }] }],
    },
    {
      id: 'Word:taggless',
      type: 'Word',
      form: 'taggless',
      homograph: 1,
      senses: [{ id: 'S6', glosses: [{ text: 'no language' }] }],
    },
  ],
  legacyAnalyses: [],
};

describe('createPt9GlossSource', () => {
  const source = createPt9GlossSource(LEXICON);

  describe('with an explicit sense selection', () => {
    it('resolves an explicit sense to its gloss for the language, matching case-insensitively', () => {
      expect(source.resolve({ Type: 'Word', Form: 'hello' }, 'S1', 'en')).toStrictEqual({
        kind: 'specific',
        senseId: 'S1',
        text: 'greeting',
      });
    });

    it('treats an absent key homograph and entry homograph 1 as the same entry', () => {
      expect(
        source.resolve({ Type: 'Word', Form: 'hello', Homograph: 1 }, 'S1', 'fr'),
      ).toStrictEqual({ kind: 'specific', senseId: 'S1', text: 'salut' });
    });

    it('resolves an explicit sense with no gloss in the language to no text', () => {
      expect(source.resolve({ Type: 'Word', Form: 'hello' }, 'S2', 'en')).toStrictEqual({
        kind: 'specific',
        senseId: 'S2',
      });
    });

    it('resolves an explicit sense whose gloss is empty to no text', () => {
      expect(source.resolve({ Type: 'Word', Form: 'empty' }, 'S3', 'en')).toStrictEqual({
        kind: 'specific',
        senseId: 'S3',
      });
    });

    it('resolves a dangling sense id to no text', () => {
      expect(source.resolve({ Type: 'Word', Form: 'hello' }, 'MISSING', 'en')).toStrictEqual({
        kind: 'specific',
        senseId: 'MISSING',
      });
    });

    it('resolves an explicit sense on a missing entry to no text', () => {
      expect(source.resolve({ Type: 'Word', Form: 'absent' }, 'S9', 'en')).toStrictEqual({
        kind: 'specific',
        senseId: 'S9',
      });
    });
  });

  describe('with no selection', () => {
    it('resolves no selection to the single glossed sense in the language', () => {
      expect(source.resolve({ Type: 'Word', Form: 'hello' }, undefined, 'en')).toStrictEqual({
        kind: 'defaultSingle',
        senseId: 'S1',
        text: 'greeting',
      });
    });

    it('resolves no selection to none when several senses are glossed in the language', () => {
      expect(source.resolve({ Type: 'Word', Form: 'multi' }, undefined, 'en')).toStrictEqual({
        kind: 'none',
      });
    });

    it('resolves no selection to none when no sense is glossed in the language', () => {
      expect(source.resolve({ Type: 'Word', Form: 'hello' }, undefined, 'de')).toStrictEqual({
        kind: 'none',
      });
    });

    it('resolves no selection to none for a missing entry', () => {
      expect(source.resolve({ Type: 'Word', Form: 'absent' }, undefined, 'en')).toStrictEqual({
        kind: 'none',
      });
    });

    it('returns a default from an id-less sense without a sense id', () => {
      expect(source.resolve({ Type: 'Word', Form: 'idless' }, undefined, 'en')).toStrictEqual({
        kind: 'defaultSingle',
        text: 'bare',
      });
    });
  });

  it('never matches a gloss that carries no language', () => {
    expect(source.resolve({ Type: 'Word', Form: 'taggless' }, undefined, 'en')).toStrictEqual({
      kind: 'none',
    });
  });

  it('resolves everything to selection-only outcomes when there is no lexicon', () => {
    const empty = createPt9GlossSource(undefined);
    expect(empty.resolve({ Type: 'Word', Form: 'hello' }, 'S1', 'en')).toStrictEqual({
      kind: 'specific',
      senseId: 'S1',
    });
    expect(empty.resolve({ Type: 'Word', Form: 'hello' }, undefined, 'en')).toStrictEqual({
      kind: 'none',
    });
  });
});
