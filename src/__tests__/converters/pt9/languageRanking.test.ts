/// <reference types="jest" />

import type { MultiString, PhraseAnalysis, TokenAnalysis } from 'interlinearizer';
import type {
  LangPhraseRecord,
  LangTokenRecord,
} from '../../../converters/pt9/languageAnalysisBuilder';
import { rankAnalysisLanguages } from '../../../converters/pt9/languageRanking';
import { FIXTURE_STAMPS, makePhraseLink, makeTokenLink } from '../../test-helpers';

const NO_ANALYSIS = {
  tokenAnalyses: [],
  tokenAnalysisLinks: [],
  phraseAnalyses: [],
  phraseAnalysisLinks: [],
};

function tokenPayload(id: string, gloss?: MultiString, morphemeGloss?: MultiString): TokenAnalysis {
  return {
    ...FIXTURE_STAMPS,
    id,
    surfaceText: 'hello',
    ...(gloss !== undefined && { gloss }),
    ...(morphemeGloss !== undefined && {
      morphemes: [
        { id: 'm0', form: 'hel', writingSystem: 'qaa' },
        { id: 'm1', form: 'lo', writingSystem: 'qaa', gloss: morphemeGloss },
      ],
    }),
  };
}

function phrasePayload(id: string, gloss: MultiString): PhraseAnalysis {
  return { ...FIXTURE_STAMPS, id, surfaceText: 'in the', gloss };
}

/** A suggested `tag` record glossing the word at `tokenRef`. */
function wordRecord(
  tag: string,
  tokenRef: string,
  overrides: Partial<LangTokenRecord> = {},
): LangTokenRecord {
  return {
    tag,
    tokenRef,
    tokenSurface: 'hello',
    tokenWritingSystem: 'qaa',
    status: 'suggested',
    ambiguous: false,
    word: { key: { Type: 'Word', Form: 'hello' }, keyId: 'Word:hello', glossText: 'hello' },
    ...overrides,
  };
}

/** A suggested `tag` record glossing the phrase over `tokenRefs`. */
function phraseRecord(
  tag: string,
  tokenRefs: string[],
  overrides: Partial<LangPhraseRecord> = {},
): LangPhraseRecord {
  return {
    tag,
    phrase: {
      key: { Type: 'Phrase', Form: 'in the' },
      keyId: 'Phrase:in the',
      glossText: 'within',
    },
    tokens: tokenRefs.map((ref) => ({ ref, surface: ref })),
    status: 'suggested',
    ambiguous: false,
    ...overrides,
  };
}

describe('rankAnalysisLanguages', () => {
  it('lists each distinct tag once, in the given order when none glosses anything', () => {
    const languages = rankAnalysisLanguages({
      languageTags: ['fr', 'en', 'fr'],
      analysis: NO_ANALYSIS,
      records: [],
      phrases: [],
    });

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('leads with the tag whose approved links show a gloss on the most tokens', () => {
    const languages = rankAnalysisLanguages({
      languageTags: ['en', 'fr'],
      analysis: {
        ...NO_ANALYSIS,
        tokenAnalyses: [tokenPayload('en', { en: 'hello' }), tokenPayload('fr', { fr: 'salut' })],
        tokenAnalysisLinks: [
          makeTokenLink('en', 'GEN 1:1:0'),
          makeTokenLink('fr', 'GEN 1:1:0'),
          makeTokenLink('fr', 'GEN 1:1:6'),
        ],
      },
      records: [],
      phrases: [],
    });

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('does not count a gloss on a token link that is not approved', () => {
    // Counting fr's candidate link would tie en's one approved token; a tie keeps fr first.
    const languages = rankAnalysisLanguages({
      languageTags: ['fr', 'en'],
      analysis: {
        ...NO_ANALYSIS,
        tokenAnalyses: [tokenPayload('en', { en: 'hello' }), tokenPayload('fr', { fr: 'salut' })],
        tokenAnalysisLinks: [
          makeTokenLink('en', 'GEN 1:1:0'),
          makeTokenLink('fr', 'GEN 1:1:0', { status: 'candidate' }),
        ],
      },
      records: [],
      phrases: [],
    });

    expect(languages).toStrictEqual(['en', 'fr']);
  });

  it('does not count a gloss on a phrase link that is not approved', () => {
    // fr's rejected link covers two tokens. Counting them would beat en's one approved token.
    const languages = rankAnalysisLanguages({
      languageTags: ['fr', 'en'],
      analysis: {
        tokenAnalyses: [tokenPayload('en', { en: 'hello' })],
        tokenAnalysisLinks: [makeTokenLink('en', 'GEN 1:1:0')],
        phraseAnalyses: [phrasePayload('fr-phrase', { fr: 'dans le' })],
        phraseAnalysisLinks: [
          { ...makePhraseLink('fr-phrase', ['GEN 1:1:6', 'GEN 1:1:9']), status: 'rejected' },
        ],
      },
      records: [],
      phrases: [],
    });

    expect(languages).toStrictEqual(['en', 'fr']);
  });

  it('counts a token whose approved analysis glosses only a morpheme', () => {
    const languages = rankAnalysisLanguages({
      languageTags: ['en', 'fr'],
      analysis: {
        ...NO_ANALYSIS,
        tokenAnalyses: [tokenPayload('fr', undefined, { fr: 'ut' })],
        tokenAnalysisLinks: [makeTokenLink('fr', 'GEN 1:1:0')],
      },
      records: [],
      phrases: [],
    });

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('counts every token under an approved phrase link', () => {
    const languages = rankAnalysisLanguages({
      languageTags: ['fr', 'en'],
      analysis: {
        tokenAnalyses: [tokenPayload('fr', { fr: 'salut' })],
        tokenAnalysisLinks: [makeTokenLink('fr', 'GEN 1:1:0')],
        phraseAnalyses: [phrasePayload('en-phrase', { en: 'within' })],
        phraseAnalysisLinks: [makePhraseLink('en-phrase', ['GEN 1:1:6', 'GEN 1:1:9'])],
      },
      records: [],
      phrases: [],
    });

    expect(languages).toStrictEqual(['en', 'fr']);
  });

  it('counts a token shown glossed by both a word and a phrase once', () => {
    // en shows two tokens; counting "in" twice would tie fr at three and keep en first.
    const languages = rankAnalysisLanguages({
      languageTags: ['en', 'fr'],
      analysis: {
        tokenAnalyses: [tokenPayload('en', { en: 'in' }), tokenPayload('fr', { fr: 'salut' })],
        tokenAnalysisLinks: [
          makeTokenLink('en', 'GEN 1:1:6'),
          makeTokenLink('fr', 'GEN 1:1:0'),
          makeTokenLink('fr', 'GEN 1:1:6'),
          makeTokenLink('fr', 'GEN 1:1:9'),
        ],
        phraseAnalyses: [phrasePayload('en-phrase', { en: 'within' })],
        phraseAnalysisLinks: [makePhraseLink('en-phrase', ['GEN 1:1:6', 'GEN 1:1:9'])],
      },
      records: [],
      phrases: [],
    });

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('ranks a tag shown on more tokens ahead of one glossing more on unrejected records', () => {
    const languages = rankAnalysisLanguages({
      languageTags: ['fr', 'en'],
      analysis: {
        ...NO_ANALYSIS,
        tokenAnalyses: [tokenPayload('en', { en: 'hello' })],
        tokenAnalysisLinks: [makeTokenLink('en', 'GEN 1:1:0')],
      },
      records: [wordRecord('fr', 'GEN 1:1:0')],
      phrases: [phraseRecord('fr', ['GEN 1:1:6', 'GEN 1:1:9'])],
    });

    expect(languages).toStrictEqual(['en', 'fr']);
  });

  it('breaks a tie at no shown tokens by the tokens unrejected records gloss', () => {
    const languages = rankAnalysisLanguages({
      languageTags: ['fr', 'en'],
      analysis: NO_ANALYSIS,
      records: [wordRecord('fr', 'GEN 1:1:0')],
      phrases: [phraseRecord('en', ['GEN 1:1:6', 'GEN 1:1:9'])],
    });

    expect(languages).toStrictEqual(['en', 'fr']);
  });

  it('breaks a tie at one shown token each by the tokens unrejected records gloss', () => {
    // The tie on shown tokens alone would keep fr first.
    const languages = rankAnalysisLanguages({
      languageTags: ['fr', 'en'],
      analysis: {
        ...NO_ANALYSIS,
        tokenAnalyses: [tokenPayload('en', { en: 'hello' }), tokenPayload('fr', { fr: 'salut' })],
        tokenAnalysisLinks: [makeTokenLink('en', 'GEN 1:1:0'), makeTokenLink('fr', 'GEN 1:1:0')],
      },
      records: [
        wordRecord('fr', 'GEN 1:1:0'),
        wordRecord('en', 'GEN 1:1:0'),
        wordRecord('en', 'GEN 1:1:6'),
      ],
      phrases: [],
    });

    expect(languages).toStrictEqual(['en', 'fr']);
  });

  it('counts a record glossed only through a parse lexeme', () => {
    const languages = rankAnalysisLanguages({
      languageTags: ['en', 'fr'],
      analysis: NO_ANALYSIS,
      records: [
        wordRecord('fr', 'GEN 1:1:0', {
          word: undefined,
          parse: {
            lexemes: [
              { key: { Type: 'Stem', Form: 'hel' }, keyId: 'Stem:hel' },
              { key: { Type: 'Suffix', Form: 'lo' }, keyId: 'Suffix:lo', glossText: 'ut' },
            ],
            signature: 'Stem:hel/Suffix:lo',
          },
        }),
      ],
      phrases: [],
    });

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it.each<{ name: string; records: LangTokenRecord[]; phrases: LangPhraseRecord[] }>([
    {
      name: 'a rejected word record',
      records: [wordRecord('fr', 'GEN 1:1:0', { status: 'rejected' })],
      phrases: [],
    },
    {
      name: 'a word record without gloss text',
      records: [
        wordRecord('fr', 'GEN 1:1:6', {
          word: { key: { Type: 'Word', Form: 'in' }, keyId: 'Word:in' },
          parse: {
            lexemes: [{ key: { Type: 'Stem', Form: 'in' }, keyId: 'Stem:in' }],
            signature: 'Stem:in',
          },
        }),
      ],
      phrases: [],
    },
    {
      name: 'a rejected phrase record',
      records: [],
      phrases: [phraseRecord('fr', ['GEN 1:1:9', 'GEN 1:1:13'], { status: 'rejected' })],
    },
    {
      name: 'a phrase record without gloss text',
      records: [],
      phrases: [
        phraseRecord('fr', ['GEN 1:1:9', 'GEN 1:1:13'], {
          phrase: { key: { Type: 'Phrase', Form: 'in the' }, keyId: 'Phrase:in the' },
        }),
      ],
    },
  ])('does not count $name', ({ records, phrases }) => {
    // en glosses one token. Counting fr's record would tie or beat en; either way, fr would lead.
    const languages = rankAnalysisLanguages({
      languageTags: ['fr', 'en'],
      analysis: NO_ANALYSIS,
      records: [wordRecord('en', 'GEN 1:1:0'), ...records],
      phrases,
    });

    expect(languages).toStrictEqual(['en', 'fr']);
  });
});
