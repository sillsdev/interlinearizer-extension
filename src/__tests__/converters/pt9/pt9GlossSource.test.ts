/// <reference types="jest" />

import type { LexiconData } from 'parsers/pt9/lexiconXmlParser';
import { createPt9GlossSource } from '../../../converters/pt9/pt9GlossSource';

/** A lexicon whose entries exercise every resolution path. */
const LEXICON: LexiconData = {
  Language: 'en',
  Entries: [
    {
      Key: { Type: 'Word', Form: 'hello', Homograph: 1 },
      Senses: [
        {
          Id: 'S1',
          Glosses: [
            { Language: 'EN', Text: 'greeting' },
            { Language: 'fr', Text: 'salut' },
          ],
        },
        { Id: 'S2', Glosses: [{ Language: 'fr', Text: 'coucou' }] },
      ],
    },
    {
      Key: { Type: 'Word', Form: 'empty' },
      Senses: [{ Id: 'S3', Glosses: [{ Language: 'en', Text: '' }] }],
    },
    {
      Key: { Type: 'Word', Form: 'multi' },
      Senses: [
        { Id: 'S4', Glosses: [{ Language: 'en', Text: 'one' }] },
        { Id: 'S5', Glosses: [{ Language: 'en', Text: 'two' }] },
      ],
    },
    {
      Key: { Type: 'Word', Form: 'idless' },
      Senses: [{ Glosses: [{ Language: 'en', Text: 'bare' }] }],
    },
    {
      Key: { Type: 'Word', Form: 'taggless' },
      Senses: [{ Id: 'S6', Glosses: [{ Text: 'no language' }] }],
    },
  ],
  Analyses: {},
};

describe('createPt9GlossSource', () => {
  const source = createPt9GlossSource(LEXICON);

  it('resolves an explicit sense to its gloss for the language, matching case-insensitively', () => {
    expect(source.resolve({ Type: 'Word', Form: 'hello' }, 'S1', 'en')).toStrictEqual({
      kind: 'specific',
      senseId: 'S1',
      text: 'greeting',
    });
  });

  it('treats an absent Homograph and homograph 1 as the same entry', () => {
    expect(source.resolve({ Type: 'Word', Form: 'hello', Homograph: 1 }, 'S1', 'fr')).toStrictEqual(
      { kind: 'specific', senseId: 'S1', text: 'salut' },
    );
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

  it('treats an empty sense id as no selection', () => {
    expect(source.resolve({ Type: 'Word', Form: 'hello' }, '', 'en')).toStrictEqual({
      kind: 'defaultSingle',
      senseId: 'S1',
      text: 'greeting',
    });
  });

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

  it('never matches a gloss that carries no Language attribute', () => {
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
