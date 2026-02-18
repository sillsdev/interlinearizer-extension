/** @file Unit tests for {@link InterlinearXmlParser}. */
/// <reference types="jest" />

import * as fs from 'fs';
import * as path from 'path';

import { InterlinearXmlParser } from 'parsers/interlinearXmlParser';

describe('InterlinearXmlParser', () => {
  let parser: InterlinearXmlParser;

  beforeEach(() => {
    parser = new InterlinearXmlParser();
  });

  describe('parse() - valid XML', () => {
    it('parses minimal valid XML with one verse and one cluster', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="4" />
                  <Lexeme Id="Word:word" GlossId="sense1" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result).toEqual({
        ScrTextName: '',
        GlossLanguage: 'en',
        BookId: 'MAT',
        Verses: {
          'MAT 1:1': {
            Hash: '',
            Clusters: [
              {
                TextRange: { Index: 0, Length: 4 },
                Lexemes: [{ LexemeId: 'Word:word', SenseId: 'sense1' }],
                LexemesId: 'Word:word',
                Id: 'Word:word/0-4',
                Excluded: false,
              },
            ],
            Punctuations: [],
          },
        },
      });
    });

    it('parses optional ScrTextName and verse Hash', () => {
      const xml = `
        <InterlinearData ScrTextName="MyProject" GlossLanguage="en" BookId="RUT">
          <Verses>
            <item>
              <string>RUT 3:1</string>
              <VerseData Hash="ABC123">
                <Cluster>
                  <Range Index="1" Length="2" />
                  <Lexeme Id="x" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.ScrTextName).toBe('MyProject');
      expect(result.Verses['RUT 3:1'].Hash).toBe('ABC123');
    });

    it('parses purely numeric verse Hash', () => {
      const xml = `
        <InterlinearData ScrTextName="MyProject" GlossLanguage="en" BookId="RUT">
          <Verses>
            <item>
              <string>RUT 3:1</string>
              <VerseData Hash="123456">
                <Cluster>
                  <Range Index="1" Length="2" />
                  <Lexeme Id="x" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.ScrTextName).toBe('MyProject');
      expect(result.Verses['RUT 3:1'].Hash).toBe('123456');
    });

    it('parses cluster with multiple lexemes and builds LexemesId and Id correctly', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="5" Length="5" />
                  <Lexeme Id="Stem:hello" GlossId="g1" />
                  <Lexeme Id="Suffix:ing" GlossId="g2" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      const cluster = result.Verses['MAT 1:1'].Clusters[0];
      expect(cluster.Lexemes).toEqual([
        { LexemeId: 'Stem:hello', SenseId: 'g1' },
        { LexemeId: 'Suffix:ing', SenseId: 'g2' },
      ]);
      expect(cluster.LexemesId).toBe('Stem:hello/Suffix:ing');
      expect(cluster.Id).toBe('Stem:hello/Suffix:ing/5-5');
    });

    it('parses lexeme Id containing slash: LexemesId and Id preserve the slash (slash-safe)', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="12" />
                  <Lexeme Id="Word:hello/world" GlossId="g1" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      const cluster = result.Verses['MAT 1:1'].Clusters[0];
      expect(cluster.Lexemes).toEqual([{ LexemeId: 'Word:hello/world', SenseId: 'g1' }]);
      expect(cluster.LexemesId).toBe('Word:hello/world');
      expect(cluster.Id).toBe('Word:hello/world/0-12');
    });

    it('preserves slash when joining Lexeme Ids (multiple lexemes, one Id contains slash)', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="5" Length="11" />
                  <Lexeme Id="Stem:foo/bar" GlossId="g1" />
                  <Lexeme Id="Suffix:ing" GlossId="g2" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      const cluster = result.Verses['MAT 1:1'].Clusters[0];
      expect(cluster.Lexemes).toEqual([
        { LexemeId: 'Stem:foo/bar', SenseId: 'g1' },
        { LexemeId: 'Suffix:ing', SenseId: 'g2' },
      ]);
      expect(cluster.LexemesId).toBe('Stem:foo/bar/Suffix:ing');
      expect(cluster.Id).toBe('Stem:foo/bar/Suffix:ing/5-11');
    });

    it('parses cluster with no lexemes: Id is Index-Length only (no leading slash)', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="10" Length="3" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      const cluster = result.Verses['MAT 1:1'].Clusters[0];
      expect(cluster.Lexemes).toEqual([]);
      expect(cluster.LexemesId).toBe('');
      expect(cluster.Id).toBe('10-3');
    });

    it('parses Lexeme without GlossId as empty SenseId', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="Word:a" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses['MAT 1:1'].Clusters[0].Lexemes[0]).toEqual({
        LexemeId: 'Word:a',
        SenseId: '',
      });
    });

    it('parses Cluster with Excluded=true', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="4" />
                  <Lexeme Id="Word:word" />
                  <Excluded>true</Excluded>
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses['MAT 1:1'].Clusters[0].Excluded).toBe(true);
    });

    it('parses Cluster with Excluded=false', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="4" />
                  <Lexeme Id="Word:word" />
                  <Excluded>false</Excluded>
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses['MAT 1:1'].Clusters[0].Excluded).toBe(false);
    });

    it('parses Cluster without Excluded as Excluded=false', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="4" />
                  <Lexeme Id="Word:word" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses['MAT 1:1'].Clusters[0].Excluded).toBe(false);
    });

    it('parses Punctuation with Range, BeforeText, AfterText', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="x" />
                </Cluster>
                <Punctuation>
                  <Range Index="34" Length="2" />
                  <BeforeText>? </BeforeText>
                  <AfterText>? </AfterText>
                </Punctuation>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      // Parser uses trimValues: false, so tag text is not trimmed.
      expect(result.Verses['MAT 1:1'].Punctuations).toEqual([
        {
          TextRange: { Index: 34, Length: 2 },
          BeforeText: '? ',
          AfterText: '? ',
        },
      ]);
    });

    it('omits Punctuation entries without valid Range', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="x" />
                </Cluster>
                <Punctuation>
                  <BeforeText>a</BeforeText>
                  <AfterText>b</AfterText>
                </Punctuation>
                <Punctuation>
                  <Range Index="1" Length="2" />
                  <BeforeText>c</BeforeText>
                  <AfterText>d</AfterText>
                </Punctuation>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses['MAT 1:1'].Punctuations).toHaveLength(1);
      expect(result.Verses['MAT 1:1'].Punctuations[0]).toEqual({
        TextRange: { Index: 1, Length: 2 },
        BeforeText: 'c',
        AfterText: 'd',
      });
    });

    it('omits Punctuation entries when Range Index or Length is not finite (missing or non-numeric)', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="x" />
                </Cluster>
                <Punctuation>
                  <Range Index="5" Length="1" />
                  <BeforeText>valid</BeforeText>
                </Punctuation>
                <Punctuation>
                  <Range Length="2" />
                  <BeforeText>no Index</BeforeText>
                </Punctuation>
                <Punctuation>
                  <Range Index="10" />
                  <BeforeText>no Length</BeforeText>
                </Punctuation>
                <Punctuation>
                  <Range Index="x" Length="1" />
                  <BeforeText>non-numeric Index</BeforeText>
                </Punctuation>
                <Punctuation>
                  <Range Index="0" Length="y" />
                  <BeforeText>non-numeric Length</BeforeText>
                </Punctuation>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses['MAT 1:1'].Punctuations).toHaveLength(1);
      expect(result.Verses['MAT 1:1'].Punctuations[0]).toEqual({
        TextRange: { Index: 5, Length: 1 },
        BeforeText: 'valid',
        AfterText: '',
      });
    });

    it('parses Punctuation with valid Range but missing BeforeText/AfterText as empty strings', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="x" />
                </Cluster>
                <Punctuation>
                  <Range Index="10" Length="1" />
                </Punctuation>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses['MAT 1:1'].Punctuations).toHaveLength(1);
      expect(result.Verses['MAT 1:1'].Punctuations[0]).toEqual({
        TextRange: { Index: 10, Length: 1 },
        BeforeText: '',
        AfterText: '',
      });
    });

    it('parses multiple verses and preserves verse keys', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="a" />
                </Cluster>
              </VerseData>
            </item>
            <item>
              <string>MAT 1:2</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="b" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(Object.keys(result.Verses)).toEqual(['MAT 1:1', 'MAT 1:2']);
      expect(result.Verses['MAT 1:1'].Clusters[0].Lexemes[0].LexemeId).toBe('a');
      expect(result.Verses['MAT 1:2'].Clusters[0].Lexemes[0].LexemeId).toBe('b');
    });

    it('parses item with missing VerseData as empty Hash, Clusters, Punctuations', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses['MAT 1:1']).toEqual({
        Hash: '',
        Clusters: [],
        Punctuations: [],
      });
    });

    it('parses VerseData with no Cluster or Punctuation as empty arrays', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:11</string>
              <VerseData />
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses['MAT 1:11']).toEqual({
        Hash: '',
        Clusters: [],
        Punctuations: [],
      });
    });

    it('parses VerseData with Punctuation but no Cluster (Cluster ?? [] branch)', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Punctuation>
                  <Range Index="0" Length="1" />
                  <BeforeText>,</BeforeText>
                  <AfterText>,</AfterText>
                </Punctuation>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses['MAT 1:1'].Clusters).toEqual([]);
      expect(result.Verses['MAT 1:1'].Punctuations).toHaveLength(1);
      expect(result.Verses['MAT 1:1'].Punctuations[0]).toEqual({
        TextRange: { Index: 0, Length: 1 },
        BeforeText: ',',
        AfterText: ',',
      });
    });

    it('parses Verses with no item array (item ?? [] branch) as empty verses record', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <dummy />
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(result.Verses).toEqual({});
      expect(result.GlossLanguage).toBe('en');
      expect(result.BookId).toBe('MAT');
    });

    it('skips items with missing string (verse key)', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="x" />
                </Cluster>
              </VerseData>
            </item>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="y" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      const result = parser.parse(xml);

      expect(Object.keys(result.Verses)).toEqual(['MAT 1:1']);
      expect(result.Verses['MAT 1:1'].Clusters[0].Lexemes[0].LexemeId).toBe('y');
    });

    it('parses real test-data file without throwing', () => {
      const xmlPath = path.join(__dirname, '..', '..', '..', 'test-data', 'Interlinear_en_MAT.xml');
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const result = parser.parse(xml);

      expect(result.GlossLanguage).toBe('en');
      expect(result.BookId).toBe('MAT');
      expect(result.ScrTextName).toBe('');
      expect(Object.keys(result.Verses).length).toBeGreaterThan(0);

      const mat11 = result.Verses['MAT 1:1'];
      expect(mat11).toBeDefined();
      expect(mat11.Hash).toBe('C8D38188');
      expect(mat11.Clusters.length).toBeGreaterThan(0);
      const firstCluster = mat11.Clusters[0];
      expect(firstCluster.TextRange).toEqual({ Index: 5, Length: 5 });
      expect(firstCluster.Lexemes[0]).toEqual({
        LexemeId: 'Word:hello',
        SenseId: 'WvbPwa9D',
      });
      expect(firstCluster.Id).toMatch(/^Word:hello\/5-5$/);

      const versesWithPunctuation = Object.values(result.Verses).filter(
        (v) => v.Punctuations.length > 0,
      );
      expect(versesWithPunctuation.length).toBeGreaterThan(0);
      const [firstWithPunctuation] = versesWithPunctuation;
      expect(firstWithPunctuation.Punctuations[0]).toHaveProperty('TextRange');
      expect(firstWithPunctuation.Punctuations[0]).toHaveProperty('BeforeText');
      expect(firstWithPunctuation.Punctuations[0]).toHaveProperty('AfterText');
    });
  });

  describe('parse() - invalid XML / errors', () => {
    it('throws when root element is not InterlinearData', () => {
      const xml = `
        <OtherRoot GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData />
            </item>
          </Verses>
        </OtherRoot>
      `;
      expect(() => parser.parse(xml)).toThrow('Invalid XML: Missing InterlinearData root element');
    });

    it('throws when GlossLanguage is missing', () => {
      const xml = `
        <InterlinearData BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData />
            </item>
          </Verses>
        </InterlinearData>
      `;
      expect(() => parser.parse(xml)).toThrow(
        'Invalid XML: Missing required attributes GlossLanguage or BookId',
      );
    });

    it('throws when BookId is missing', () => {
      const xml = `
        <InterlinearData GlossLanguage="en">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData />
            </item>
          </Verses>
        </InterlinearData>
      `;
      expect(() => parser.parse(xml)).toThrow(
        'Invalid XML: Missing required attributes GlossLanguage or BookId',
      );
    });

    it('throws when GlossLanguage is empty string', () => {
      const xml = `
        <InterlinearData GlossLanguage="" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData />
            </item>
          </Verses>
        </InterlinearData>
      `;
      expect(() => parser.parse(xml)).toThrow(
        'Invalid XML: Missing required attributes GlossLanguage or BookId',
      );
    });

    it('throws when Verses element is missing', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
        </InterlinearData>
      `;
      expect(() => parser.parse(xml)).toThrow('Invalid XML: Missing Verses element');
    });

    it('throws when Cluster is missing Range element', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Lexeme Id="x" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      expect(() => parser.parse(xml)).toThrow(
        'Invalid XML: Cluster missing required Range element',
      );
    });

    it('throws when Range is missing Index or Length', () => {
      const xmlNoIndex = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Length="2" />
                  <Lexeme Id="x" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      expect(() => parser.parse(xmlNoIndex)).toThrow(
        'Invalid XML: Range missing required Index or Length attributes',
      );

      const xmlNoLength = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" />
                  <Lexeme Id="x" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      expect(() => parser.parse(xmlNoLength)).toThrow(
        'Invalid XML: Range missing required Index or Length attributes',
      );
    });

    it('throws when Lexeme is missing Id attribute', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme GlossId="sense1" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      expect(() => parser.parse(xml)).toThrow('Invalid XML: Lexeme missing required Id attribute');
    });

    it('throws when the same verse reference appears in more than one item', () => {
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="a" />
                </Cluster>
              </VerseData>
            </item>
            <item>
              <string>MAT 1:2</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="b" />
                </Cluster>
              </VerseData>
            </item>
            <item>
              <string>MAT 1:1</string>
              <VerseData>
                <Cluster>
                  <Range Index="0" Length="1" />
                  <Lexeme Id="c" />
                </Cluster>
              </VerseData>
            </item>
          </Verses>
        </InterlinearData>
      `;
      expect(() => parser.parse(xml)).toThrow(
        'Invalid XML: Duplicate verse reference "MAT 1:1". At most one VerseData per reference is allowed.',
      );
    });
  });

  describe('constructor and instance', () => {
    it('can be instantiated multiple times', () => {
      const p1 = new InterlinearXmlParser();
      const p2 = new InterlinearXmlParser();
      const xml = `
        <InterlinearData GlossLanguage="en" BookId="MAT">
          <Verses>
            <item>
              <string>MAT 1:1</string>
              <VerseData />
            </item>
          </Verses>
        </InterlinearData>
      `;
      expect(p1.parse(xml)).toEqual(p2.parse(xml));
    });
  });
});
