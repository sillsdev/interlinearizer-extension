/// <reference types="jest" />

import * as fs from 'node:fs';
import * as path from 'node:path';

import { LexiconXmlParser } from 'parsers/pt9/lexiconXmlParser';

describe('LexiconXmlParser', () => {
  let parser: LexiconXmlParser;

  beforeEach(() => {
    parser = new LexiconXmlParser();
  });

  describe('parse() - valid XML', () => {
    it('parses a minimal lexicon with one entry', () => {
      const xml = `
        <Lexicon>
          <Language>en</Language>
          <FontName>Arial</FontName>
          <FontSize>10</FontSize>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="voici" Homograph="1" />
              <Entry>
                <Sense Id="CKVPllxu">
                  <Gloss Language="en">is</Gloss>
                </Sense>
              </Entry>
            </item>
          </Entries>
        </Lexicon>
      `;

      expect(parser.parse(xml)).toStrictEqual({
        Language: 'en',
        FontName: 'Arial',
        FontSize: '10',
        Entries: [
          {
            Key: { Type: 'Word', Form: 'voici', Homograph: 1 },
            Senses: [{ Id: 'CKVPllxu', Glosses: [{ Language: 'en', Text: 'is' }] }],
          },
        ],
        Analyses: {},
      });
    });

    it('parses an empty root element as an empty lexicon', () => {
      expect(parser.parse('<Lexicon />')).toStrictEqual({ Entries: [], Analyses: {} });
    });

    it('parses a lexicon with no Entries or Analyses containers', () => {
      expect(parser.parse('<Lexicon><Language>fr</Language></Lexicon>')).toStrictEqual({
        Language: 'fr',
        Entries: [],
        Analyses: {},
      });
    });

    it('parses empty Entries and Analyses containers as empty collections', () => {
      expect(parser.parse('<Lexicon><Entries /><Analyses /></Lexicon>')).toStrictEqual({
        Entries: [],
        Analyses: {},
      });
    });

    it('parses containers with no item children as empty collections', () => {
      const xml = `
        <Lexicon>
          <Entries><dummy /></Entries>
          <Analyses><dummy /></Analyses>
        </Lexicon>
      `;
      expect(parser.parse(xml)).toStrictEqual({ Entries: [], Analyses: {} });
    });

    it('preserves an absent Homograph attribute as an absent field', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Stem" Form="exauc" />
              <Entry />
            </item>
          </Entries>
        </Lexicon>
      `;
      const result = parser.parse(xml);

      expect(result.Entries[0].Key).toStrictEqual({ Type: 'Stem', Form: 'exauc' });
    });

    it('parses an empty Entry element as an entry with no senses', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Stem" Form="ab" Homograph="1" />
              <Entry />
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(parser.parse(xml).Entries[0].Senses).toStrictEqual([]);
    });

    it('parses an item with no Entry element as an entry with no senses', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Stem" Form="ab" />
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(parser.parse(xml).Entries[0].Senses).toStrictEqual([]);
    });

    it('parses an empty Sense element as a sense with no id and no glosses', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="x" />
              <Entry>
                <Sense />
              </Entry>
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(parser.parse(xml).Entries[0].Senses).toStrictEqual([{ Glosses: [] }]);
    });

    it('parses a Sense with an Id and no glosses', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="x" />
              <Entry>
                <Sense Id="k2PH7X/I" />
              </Entry>
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(parser.parse(xml).Entries[0].Senses).toStrictEqual([{ Id: 'k2PH7X/I', Glosses: [] }]);
    });

    it('parses a Gloss with no Language attribute as text with an absent Language', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="x" />
              <Entry>
                <Sense Id="s1">
                  <Gloss>bare</Gloss>
                </Sense>
              </Entry>
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(parser.parse(xml).Entries[0].Senses[0].Glosses).toStrictEqual([{ Text: 'bare' }]);
    });

    it('parses an empty Gloss element as an empty string text', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="x" />
              <Entry>
                <Sense Id="s1">
                  <Gloss Language="en" />
                </Sense>
              </Entry>
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(parser.parse(xml).Entries[0].Senses[0].Glosses).toStrictEqual([
        { Language: 'en', Text: '' },
      ]);
    });

    it('parses an Entry containing no Sense elements as an entry with no senses', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="x" />
              <Entry><dummy /></Entry>
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(parser.parse(xml).Entries[0].Senses).toStrictEqual([]);
    });

    it('parses a Gloss carrying only a foreign attribute as text with an absent Language', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="x" />
              <Entry>
                <Sense Id="s1">
                  <Gloss other="attr">bare</Gloss>
                </Sense>
              </Entry>
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(parser.parse(xml).Entries[0].Senses[0].Glosses).toStrictEqual([{ Text: 'bare' }]);
    });

    it('parses an ArrayOfLexeme containing no Lexeme elements as an analysis with no lexemes', () => {
      const xml = `
        <Lexicon>
          <Analyses>
            <item>
              <string>word</string>
              <ArrayOfLexeme><dummy /></ArrayOfLexeme>
            </item>
          </Analyses>
        </Lexicon>
      `;
      expect(parser.parse(xml).Analyses).toStrictEqual({ word: [] });
    });

    it('parses multiple glosses per sense in document order', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="x" />
              <Entry>
                <Sense Id="s1">
                  <Gloss Language="en">one</Gloss>
                  <Gloss Language="fr">un</Gloss>
                </Sense>
              </Entry>
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(parser.parse(xml).Entries[0].Senses[0].Glosses).toStrictEqual([
        { Language: 'en', Text: 'one' },
        { Language: 'fr', Text: 'un' },
      ]);
    });

    it('parses legacy Analyses items with their lexeme keys', () => {
      const xml = `
        <Lexicon>
          <Analyses>
            <item>
              <string>exaucera</string>
              <ArrayOfLexeme>
                <Lexeme Type="Stem" Form="exauc" Homograph="1" />
                <Lexeme Type="Suffix" Form="era" Homograph="1" />
              </ArrayOfLexeme>
            </item>
          </Analyses>
        </Lexicon>
      `;
      expect(parser.parse(xml).Analyses).toStrictEqual({
        exaucera: [
          { Type: 'Stem', Form: 'exauc', Homograph: 1 },
          { Type: 'Suffix', Form: 'era', Homograph: 1 },
        ],
      });
    });

    it('parses an empty ArrayOfLexeme as an analysis with no lexemes', () => {
      const xml = `
        <Lexicon>
          <Analyses>
            <item>
              <string>word</string>
              <ArrayOfLexeme />
            </item>
          </Analyses>
        </Lexicon>
      `;
      expect(parser.parse(xml).Analyses).toStrictEqual({ word: [] });
    });

    it('parses an Analyses item with no ArrayOfLexeme as an analysis with no lexemes', () => {
      const xml = `
        <Lexicon>
          <Analyses>
            <item>
              <string>word</string>
            </item>
          </Analyses>
        </Lexicon>
      `;
      expect(parser.parse(xml).Analyses).toStrictEqual({ word: [] });
    });

    it('parses the real test-data lexicon fixture', () => {
      const xmlPath = path.join(__dirname, '..', '..', '..', '..', 'test-data', 'Lexicon.xml');
      const result = parser.parse(fs.readFileSync(xmlPath, 'utf-8'));

      expect(result.Language).toBe('en');
      expect(result.Entries).toHaveLength(7);

      const hello = result.Entries.find((e) => e.Key.Type === 'Word' && e.Key.Form === 'hello');
      expect(hello?.Senses[0].Id).toBe('WvbPwa9D');
      expect(hello?.Senses[0].Glosses).toStrictEqual([
        { Language: 'en', Text: 'greeting' },
        { Language: 'fr', Text: 'salut' },
      ]);

      const homographs = result.Entries.filter((e) => e.Key.Type === 'Word' && e.Key.Form === 'a');
      expect(homographs.map((e) => e.Key.Homograph)).toStrictEqual([1, 2]);

      const senselessStem = result.Entries.find(
        (e) => e.Key.Type === 'Stem' && e.Key.Form === 'ab',
      );
      expect(senselessStem?.Senses).toStrictEqual([]);

      expect(result.Analyses).toStrictEqual({
        aaaa: [{ Type: 'Stem', Form: 'aaaa', Homograph: 1 }],
      });
    });
  });

  describe('parse() - invalid XML / errors', () => {
    it('throws when the Lexicon root element is absent', () => {
      expect(() => parser.parse('<OtherRoot />')).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining('Invalid XML: Missing Lexicon root element'),
        }),
      );
    });

    it('throws when an Entries item has no Lexeme key element', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Entry />
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(() => parser.parse(xml)).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining(
            'Invalid XML: Entries item missing its Lexeme key element',
          ),
        }),
      );
    });

    it.each([
      ['<Lexeme Form="x" />', 'missing Type'],
      ['<Lexeme Type="Word" />', 'missing Form'],
      ['<Lexeme Type="" Form="x" />', 'empty Type'],
    ])('throws when the key element is %s (%s)', (lexeme) => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              ${lexeme}
              <Entry />
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(() => parser.parse(xml)).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining(
            'Invalid XML: Lexeme key missing Type or Form attribute',
          ),
        }),
      );
    });

    it.each(['x', '-1', '1.5', ''])(
      'throws when a Homograph attribute is the non-numeric "%s"',
      (homograph) => {
        const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="a" Homograph="${homograph}" />
              <Entry />
            </item>
          </Entries>
        </Lexicon>
      `;
        expect(() => parser.parse(xml)).toThrow(
          expect.objectContaining({
            name: 'SyntaxError',
            message: expect.stringContaining('non-numeric Homograph attribute'),
          }),
        );
      },
    );

    it('throws on duplicate entry keys', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="a" Homograph="2" />
              <Entry />
            </item>
            <item>
              <Lexeme Type="Word" Form="a" Homograph="2" />
              <Entry />
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(() => parser.parse(xml)).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining('Invalid XML: Duplicate lexicon entry key "Word:a:2"'),
        }),
      );
    });

    it('throws on duplicate entry keys when one side writes Homograph="1" and the other omits it', () => {
      const xml = `
        <Lexicon>
          <Entries>
            <item>
              <Lexeme Type="Word" Form="a" Homograph="1" />
              <Entry />
            </item>
            <item>
              <Lexeme Type="Word" Form="a" />
              <Entry />
            </item>
          </Entries>
        </Lexicon>
      `;
      expect(() => parser.parse(xml)).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining('Invalid XML: Duplicate lexicon entry key "Word:a"'),
        }),
      );
    });

    it('throws when an Analyses item has no wordform key', () => {
      const xml = `
        <Lexicon>
          <Analyses>
            <item>
              <ArrayOfLexeme />
            </item>
          </Analyses>
        </Lexicon>
      `;
      expect(() => parser.parse(xml)).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining('Invalid XML: Analyses item missing its wordform key'),
        }),
      );
    });

    it('throws when an Analyses wordform key is empty', () => {
      const xml = `
        <Lexicon>
          <Analyses>
            <item>
              <string></string>
              <ArrayOfLexeme />
            </item>
          </Analyses>
        </Lexicon>
      `;
      expect(() => parser.parse(xml)).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining('Invalid XML: Analyses item missing its wordform key'),
        }),
      );
    });

    it('throws on duplicate analyses wordforms', () => {
      const xml = `
        <Lexicon>
          <Analyses>
            <item>
              <string>word</string>
              <ArrayOfLexeme />
            </item>
            <item>
              <string>word</string>
              <ArrayOfLexeme />
            </item>
          </Analyses>
        </Lexicon>
      `;
      expect(() => parser.parse(xml)).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining('Invalid XML: Duplicate analyses wordform "word"'),
        }),
      );
    });
  });
});
