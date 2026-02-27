/**
 * @file Unit tests for {@link parseLexiconAndBuildGlossLookup}, {@link toArray}, and
 *   {@link normalizeGloss}.
 */

import {
  parseLexiconAndBuildGlossLookup,
  parseLexicon,
  lexemeKeyId,
  getWordLevelGlossForForm,
  buildGlossLookupFromLexicon,
  buildWordLevelGlossLookup,
  toArray,
  normalizeGloss,
} from 'parsers/paratext-9/lexiconParser';
import fs from 'fs';
import { getTestDataPath } from '../../test-helpers';

describe('normalizeGloss', () => {
  it('returns default language and text when Gloss object has no @_Language (covers ?? branch)', () => {
    const result = normalizeGloss({ '#text': 'gloss without lang key' });
    expect(result.lang).toBe('*');
    expect(result.text).toBe('gloss without lang key');
  });

  it('returns language and text when Gloss object has @_Language', () => {
    const result = normalizeGloss({ '@_Language': 'en', '#text': 'hello' });
    expect(result.lang).toBe('en');
    expect(result.text).toBe('hello');
  });

  it('returns default language when Gloss is string', () => {
    const result = normalizeGloss('plain string gloss');
    expect(result.lang).toBe('*');
    expect(result.text).toBe('plain string gloss');
  });
});

describe('lexemeKeyId', () => {
  it('returns "Type:LexicalForm" when homograph <= 1', () => {
    expect(lexemeKeyId({ type: 'Word', lexicalForm: 'x', homograph: 1 })).toBe('Word:x');
    expect(lexemeKeyId({ type: 'Stem', lexicalForm: 'run', homograph: 0 })).toBe('Stem:run');
  });

  it('returns "Type:LexicalForm:Homograph" when homograph > 1', () => {
    expect(lexemeKeyId({ type: 'Word', lexicalForm: 'bank', homograph: 2 })).toBe('Word:bank:2');
    expect(lexemeKeyId({ type: 'Stem', lexicalForm: 'run', homograph: 3 })).toBe('Stem:run:3');
  });
});

describe('toArray', () => {
  it('returns empty array for undefined (branch: undefined)', () => {
    expect(toArray(undefined)).toEqual([]);
  });

  it('returns same array when value is already an array (branch: array)', () => {
    const arr = [{ id: 'a' }];
    expect(toArray(arr)).toBe(arr);
    expect(toArray(arr)).toEqual([{ id: 'a' }]);
  });

  it('wraps single object in array when value is not an array (branch: single object)', () => {
    const single = { id: 'single' };
    expect(toArray(single)).toEqual([single]);
  });
});

describe('parseLexiconAndBuildGlossLookup', () => {
  it('throws when root element is not Lexicon', () => {
    const xml = '<?xml version="1.0"?><InterlinearData></InterlinearData>';
    expect(() => parseLexiconAndBuildGlossLookup(xml)).toThrow(
      'Invalid XML: Missing Lexicon root element',
    );
  });

  it('returns lookup that yields undefined for empty Lexicon', () => {
    const xml = '<?xml version="1.0"?><Lexicon><Entries /></Lexicon>';
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('anyId', 'en')).toBeUndefined();
  });

  it('returns lookup that yields undefined for senseId with no Gloss', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="x" Homograph="1" />
      <Entry>
        <Sense Id="senseNoGloss" />
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('senseNoGloss', 'en')).toBeUndefined();
  });

  it('returns gloss text for matching senseId and language', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Stem" Form="hello" Homograph="1" />
      <Entry>
        <Sense Id="Fz1CNXo3">
          <Gloss Language="en">good</Gloss>
        </Sense>
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('Fz1CNXo3', 'en')).toBe('good');
  });

  it('returns empty string when Gloss element has no text for that language', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="in" Homograph="1" />
      <Entry>
        <Sense Id="6wa5ZOr2">
          <Gloss Language="grc"></Gloss>
        </Sense>
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('6wa5ZOr2', 'grc')).toBe('');
  });

  it('returns undefined for wrong language when Sense has only other languages', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="d" Homograph="1" />
      <Entry>
        <Sense Id="wq/iyJMV">
          <Gloss Language="hbo">בֹּקֶר</Gloss>
        </Sense>
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('wq/iyJMV', 'hbo')).toBe('בֹּקֶר');
    expect(lookup('wq/iyJMV', 'en')).toBeUndefined();
  });

  it('returns undefined for empty senseId', () => {
    const xml = '<?xml version="1.0"?><Lexicon><Entries /></Lexicon>';
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('', 'en')).toBeUndefined();
  });

  it('adds no pairs for Sense with empty Id', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="x" Homograph="1" />
      <Entry>
        <Sense Id="">
          <Gloss Language="en">ignored</Gloss>
        </Sense>
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('', 'en')).toBeUndefined();
    expect(lookup('any', 'en')).toBeUndefined();
  });

  it('adds no pairs for Sense with missing Id attribute', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="z" Homograph="1" />
      <Entry>
        <Sense>
          <Gloss Language="en">no id sense</Gloss>
        </Sense>
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('any', 'en')).toBeUndefined();
  });

  it('uses default language when Gloss has empty Language attribute', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="x" Homograph="1" />
      <Entry>
        <Sense Id="noLangSense">
          <Gloss Language="">default gloss</Gloss>
        </Sense>
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('noLangSense', '*')).toBe('default gloss');
    expect(lookup('noLangSense', 'en')).toBe('default gloss');
  });

  it('uses default language when Gloss has no Language attribute (FXP returns string)', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="y" Homograph="1" />
      <Entry>
        <Sense Id="omitLangSense">
          <Gloss>no lang attribute</Gloss>
        </Sense>
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('omitLangSense', '*')).toBe('no lang attribute');
    expect(lookup('omitLangSense', 'en')).toBe('no lang attribute');
  });

  it('uses default language when Gloss is object with missing Language attribute (covers ?? branch)', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="z" Homograph="1" />
      <Entry>
        <Sense Id="mixedLangSense">
          <Gloss Language="en">en only</Gloss>
          <Gloss>no lang key</Gloss>
        </Sense>
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('mixedLangSense', 'en')).toBe('en only');
    expect(lookup('mixedLangSense', '*')).toBe('no lang key');
  });

  it('handles Entry with no Sense', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="x" Homograph="1" />
      <Entry />
    </item>
  </Entries>
</Lexicon>`;
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('any', 'en')).toBeUndefined();
  });

  it('parses test-data/Lexicon.xml and resolves known sense IDs', () => {
    const xmlPath = getTestDataPath('Lexicon.xml');
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const lookup = parseLexiconAndBuildGlossLookup(xml);
    expect(lookup('aef10f32', 'en')).toBe('in');
    expect(lookup('69eeb5e0', 'en')).toBe('the');
    expect(lookup('69f3b5c7', 'en')).toBe('begin');
  });
});

describe('parseLexicon and word-level gloss', () => {
  it('parses Lexicon XML into LexiconData with entries keyed by lexeme Id', () => {
    const xml = fs.readFileSync(getTestDataPath('Lexicon.xml'), 'utf-8');
    const lexicon = parseLexicon(xml);
    expect(lexicon.language).toBe('en');
    expect(lexicon.entries['Word:beginning']).toBeDefined();
    expect(lexicon.entries['Word:beginning'].senses[0].id).toBe('a2598f23');
    expect(lexicon.entries['Stem:begin']).toBeDefined();
    expect(getWordLevelGlossForForm(lexicon, 'beginning', 'en')).toBe('beginning');
    expect(getWordLevelGlossForForm(lexicon, 'begin', 'en')).toBeUndefined();
  });

  it('buildGlossLookupFromLexicon and buildWordLevelGlossLookup match parseLexiconAndBuildGlossLookup behaviour', () => {
    const xml = fs.readFileSync(getTestDataPath('Lexicon.xml'), 'utf-8');
    const lexicon = parseLexicon(xml);
    const glossLookup = buildGlossLookupFromLexicon(lexicon);
    const wordLevelLookup = buildWordLevelGlossLookup(lexicon);
    expect(glossLookup('aef10f32', 'en')).toBe('in');
    expect(wordLevelLookup('beginning', 'en')).toBe('beginning');
  });

  it('getWordLevelGlossForForm returns fallback gloss when requested language has no exact match', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="onlyDefault" Homograph="1" />
      <Entry>
        <Sense Id="senseDefault">
          <Gloss>default gloss text</Gloss>
        </Sense>
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lexicon = parseLexicon(xml);
    expect(getWordLevelGlossForForm(lexicon, 'onlyDefault', 'fr')).toBe('default gloss text');
    expect(getWordLevelGlossForForm(lexicon, 'onlyDefault', 'en')).toBe('default gloss text');
  });
});

describe('parseLexicon edge cases (branch coverage)', () => {
  it('falls back to Word for unknown Lexeme Type and default type/homograph when attributes missing or invalid', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries>
    <item>
      <Lexeme Type="UnknownType" Form="x" Homograph="1" />
      <Entry>
        <Sense Id="s1"><Gloss Language="en">one</Gloss></Sense>
      </Entry>
    </item>
    <item>
      <Lexeme Type="   " Form="whitespaceType" Homograph="1" />
      <Entry>
        <Sense Id="s1b"><Gloss Language="en">oneb</Gloss></Sense>
      </Entry>
    </item>
    <item>
      <Lexeme Type="Word" Homograph="2" />
      <Entry>
        <Sense Id="s2"><Gloss Language="en">two</Gloss></Sense>
      </Entry>
    </item>
    <item>
      <Lexeme Type="Word" Form="y" Homograph="abc" />
      <Entry>
        <Sense Id="s3"><Gloss Language="en">three</Gloss></Sense>
      </Entry>
    </item>
    <item>
      <Lexeme Type="Word" Form="noHomograph" />
      <Entry>
        <Sense Id="s4"><Gloss Language="en">four</Gloss></Sense>
      </Entry>
    </item>
    <item>
      <Lexeme Form="noType" Homograph="1" />
      <Entry>
        <Sense Id="s5"><Gloss Language="en">five</Gloss></Sense>
      </Entry>
    </item>
  </Entries>
</Lexicon>`;
    const lexicon = parseLexicon(xml);
    expect(lexicon.entries['Word:x']).toBeDefined();
    expect(lexicon.entries['Word:x'].key.type).toBe('Word');
    expect(lexicon.entries['Word:whitespaceType']).toBeDefined();
    expect(lexicon.entries['Word:whitespaceType'].key.type).toBe('Word');
    expect(lexicon.entries['Word::2']).toBeDefined();
    expect(lexicon.entries['Word::2'].key.lexicalForm).toBe('');
    expect(lexicon.entries['Word:y']).toBeDefined();
    expect(lexicon.entries['Word:y'].key.homograph).toBe(1);
    expect(lexicon.entries['Word:noHomograph']).toBeDefined();
    expect(lexicon.entries['Word:noHomograph'].key.homograph).toBe(1);
    expect(lexicon.entries['Word:noType']).toBeDefined();
    expect(lexicon.entries['Word:noType'].key.type).toBe('Word');
  });

  it('uses default Language, FontName, and FontSize when root attributes missing or invalid', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Entries />
</Lexicon>`;
    const lexicon = parseLexicon(xml);
    expect(lexicon.language).toBe('');
    expect(lexicon.fontName).toBe('Arial');
    expect(lexicon.fontSize).toBe(10);
  });

  it('uses default FontName when root FontName is whitespace-only and FontSize when invalid', () => {
    const xml = `
<?xml version="1.0"?>
<Lexicon>
  <Language>en</Language>
  <FontName>   </FontName>
  <FontSize>nope</FontSize>
  <Entries />
</Lexicon>`;
    const lexicon = parseLexicon(xml);
    expect(lexicon.language).toBe('en');
    expect(lexicon.fontName).toBe('Arial');
    expect(lexicon.fontSize).toBe(10);
  });
});
