/// <reference types="jest" />

import * as fs from 'node:fs';
import * as path from 'node:path';

import { WordAnalysesXmlParser } from 'parsers/pt9/wordAnalysesXmlParser';

describe('WordAnalysesXmlParser', () => {
  let parser: WordAnalysesXmlParser;

  beforeEach(() => {
    parser = new WordAnalysesXmlParser();
  });

  describe('parse() - valid XML', () => {
    it('parses an entry with one analysis of two lexemes', () => {
      const xml = `
        <WordAnalyses>
          <Entry Word="exaucera">
            <Analysis>
              <Lexeme>Stem:exauc</Lexeme>
              <Lexeme>Suffix:era</Lexeme>
            </Analysis>
          </Entry>
        </WordAnalyses>
      `;

      expect(parser.parse(xml)).toStrictEqual({
        Entries: [{ Word: 'exaucera', Analyses: [{ LexemeIds: ['Stem:exauc', 'Suffix:era'] }] }],
      });
    });

    it('parses an empty root element as an empty inventory', () => {
      expect(parser.parse('<WordAnalyses />')).toStrictEqual({ Entries: [] });
    });

    it('parses a root with no Entry children as an empty inventory', () => {
      expect(parser.parse('<WordAnalyses><dummy /></WordAnalyses>')).toStrictEqual({
        Entries: [],
      });
    });

    it('parses multiple analyses for one wordform in document order', () => {
      const xml = `
        <WordAnalyses>
          <Entry Word="abe">
            <Analysis>
              <Lexeme>Stem:ab</Lexeme>
              <Lexeme>Suffix:e</Lexeme>
            </Analysis>
            <Analysis>
              <Lexeme>Stem:abe</Lexeme>
            </Analysis>
          </Entry>
        </WordAnalyses>
      `;

      expect(parser.parse(xml).Entries[0].Analyses).toStrictEqual([
        { LexemeIds: ['Stem:ab', 'Suffix:e'] },
        { LexemeIds: ['Stem:abe'] },
      ]);
    });

    it('parses an empty Analysis element as an analysis with no lexemes', () => {
      const xml = `
        <WordAnalyses>
          <Entry Word="word">
            <Analysis />
          </Entry>
        </WordAnalyses>
      `;
      expect(parser.parse(xml).Entries[0].Analyses).toStrictEqual([{ LexemeIds: [] }]);
    });

    it('parses an Analysis containing no Lexeme elements as an analysis with no lexemes', () => {
      const xml = `
        <WordAnalyses>
          <Entry Word="word">
            <Analysis><dummy /></Analysis>
          </Entry>
        </WordAnalyses>
      `;
      expect(parser.parse(xml).Entries[0].Analyses).toStrictEqual([{ LexemeIds: [] }]);
    });

    it('parses an Entry with no Analysis children as an entry with no analyses', () => {
      const xml = `
        <WordAnalyses>
          <Entry Word="word"></Entry>
        </WordAnalyses>
      `;
      expect(parser.parse(xml).Entries[0]).toStrictEqual({ Word: 'word', Analyses: [] });
    });

    it('parses the real test-data word-analyses fixture', () => {
      const xmlPath = path.join(__dirname, '..', '..', '..', '..', 'test-data', 'WordAnalyses.xml');
      const result = parser.parse(fs.readFileSync(xmlPath, 'utf-8'));

      expect(result.Entries).toStrictEqual([
        { Word: 'helloing', Analyses: [{ LexemeIds: ['Stem:hello', 'Suffix:ing'] }] },
        {
          Word: 'abe',
          Analyses: [{ LexemeIds: ['Stem:ab', 'Suffix:e'] }, { LexemeIds: ['Stem:abe'] }],
        },
      ]);
    });
  });

  describe('parse() - invalid XML / errors', () => {
    it('throws when the WordAnalyses root element is absent', () => {
      expect(() => parser.parse('<OtherRoot />')).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining('Invalid XML: Missing WordAnalyses root element'),
        }),
      );
    });

    it('throws when an Entry is missing its Word attribute', () => {
      const xml = `
        <WordAnalyses>
          <Entry>
            <Analysis />
          </Entry>
        </WordAnalyses>
      `;
      expect(() => parser.parse(xml)).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining('Invalid XML: Entry missing its Word attribute'),
        }),
      );
    });

    it('throws when an Entry Word attribute is empty', () => {
      const xml = `
        <WordAnalyses>
          <Entry Word="">
            <Analysis />
          </Entry>
        </WordAnalyses>
      `;
      expect(() => parser.parse(xml)).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining('Invalid XML: Entry missing its Word attribute'),
        }),
      );
    });

    it('throws on duplicate wordform entries', () => {
      const xml = `
        <WordAnalyses>
          <Entry Word="word">
            <Analysis />
          </Entry>
          <Entry Word="word">
            <Analysis />
          </Entry>
        </WordAnalyses>
      `;
      expect(() => parser.parse(xml)).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining('Invalid XML: Duplicate word analyses entry "word"'),
        }),
      );
    });
  });
});
