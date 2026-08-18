# Paratext 9 XML schema

PT9 persists interlinear data in four project-local XML files, each read by its own parser in this
directory. Sample files for all four live in `test-data/`.

| File                                                       | Contents                                                      | Parser                         |
| ---------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| `Interlinear_{language}/Interlinear_{language}_{book}.xml` | Per-verse cluster selections for one gloss language and book  | `interlinearXmlParser.ts`      |
| `Lexicon.xml`                                              | Lexicon entries, senses, and gloss text; legacy word analyses | `lexiconXmlParser.ts`          |
| `WordAnalyses.xml`                                         | Confirmed wordform-to-parse inventory                         | `wordAnalysesXmlParser.ts`     |
| `InterlinearSetup.xml`                                     | Per-gloss-language configuration                              | `interlinearSetupXmlParser.ts` |

## Shared conventions

- **Dictionary serialization.** PT9 serializes dictionaries as repeated `item` elements, each wrapping
  the serialized key followed by the serialized value. Verse dictionaries key with a bare
  `<string>` element; the lexicon's `Entries` keys with a `<Lexeme>` element. Duplicate keys within
  one dictionary cause a parse error (deliberately stricter than PT9's reader, which silently keeps
  the last duplicate).
- **Lexeme keys.** A lexeme's identity appears either as a composed id string —
  `Type:Form[:Homograph]`, with homograph 1 omitted (e.g. `Word:voici`, `Word:a:2`) — or as a
  `<Lexeme Type=".." Form=".." Homograph=".." />` attribute triple. Type names come from PT9's
  append-only list, so parsers accept unknown names. `lexemeKey.ts` converts between the two
  shapes.
- **Absence is preserved.** Absent XML attributes and elements stay absent on parsed output — never
  coalesced to empty strings or defaults. Parsers throw only on corrupt input: unparseable XML, a
  missing root element, duplicate dictionary keys, and entries missing their identity (each file
  section lists its own error conditions).

## Interlinear_{language}_{book}.xml

### Document structure

- **Root element:** `InterlinearData`
  - **Attributes:**
    - `GlossLanguage` (required): Language code or name for glosses (e.g. `"en"`).
    - `BookId` (required): Book id (e.g. `"MAT"`, `"RUT"`).
    - `ScrTextName` (optional): Source text / project name.
  - **Child:** Exactly one `Verses` element.

- **Verses**
  - **Children:** Zero or more `item` elements. Each `item` represents one verse.
    - **`item`**
      - **`string`** (element text): Verse reference key (e.g. `"MAT 1:1"`, `"RUT 3:1"`). Must be unique in the document; duplicate references cause a parse error.
      - **`VerseData`** (optional): If absent, the verse is stored with no `Hash` and empty `Clusters` and `Punctuations`.

- **VerseData**
  - **Attributes:**
    - `Hash` (optional): Approval hash of the verse text. PT9 writes it only when the verse is approved, so absence is the not-approved state; the parser preserves absence (never coalesces to an empty string).
  - **Children:**
    - **`Cluster`** (zero or more): Word/morpheme clusters with range and lexemes.
    - **`Punctuation`** (zero or more): Punctuation change records.

- **Cluster**
  - **Children:**
    - **`Range`** (required): Character range in the verse text.
      - **Attributes:** `Index` (start, 0-based), `Length` (number of characters). Both must be numeric; missing or non-numeric values cause a parse error.
    - **`Lexeme`** (zero or more): Lexemes in this cluster.
      - **Attributes:**
        - `Id` (required): Lexeme id (e.g. from a Lexicon).
        - `GlossId` (optional): Id of the selected sense (a sense id despite the historical attribute name). When absent, the parsed lexeme has no `SenseId`; an empty attribute value is preserved as an empty string.
    - **`Excluded`** (optional): Boolean flag indicating this instance of a phrase should be excluded from the interlinear display at this specific location. This is a very niche property that is included because it's possible to be present in the XML, even though it's rarely used. When `true`, the phrase is not displayed at this location but remains available elsewhere. The exclusion is location-specific (applies to this instance at this text range, not globally). Omitted or `false` means the phrase is included.

- **Punctuation**
  - **Children:**
    - **`Range`** (optional): Every Punctuation entry is preserved. `TextRange` is set only when `Range` is present with numeric `Index` and `Length`; otherwise the entry has no `TextRange`. (PT9 itself reads a missing `Range` as a `(0, 0)` default; the parser preserves absence instead of fabricating a range.)
    - **`BeforeText`** (optional): Punctuation text before the change; omitted → empty string.
    - **`AfterText`** (optional): Punctuation text after the change; omitted → empty string.

### Parsed output (in-memory)

The parser produces objects conforming to the types exported from `src/parsers/pt9/interlinearXmlParser.ts`. Optional data is preserved losslessly: absent XML attributes stay absent on the output objects rather than being coalesced to empty strings.

- **InterlinearData:** `ScrTextName?` (absent when the legacy attribute is missing), `GlossLanguage`, `BookId`, `Verses` (record of verse key → **VerseData**).
- **VerseData:** `Hash?` (absent means the verse is not approved), `Clusters` (array of **ClusterData**), `Punctuations` (array of **PunctuationData**).
- **ClusterData:** `TextRange` (`Index`, `Length`), `Lexemes` (array of `{ LexemeId, SenseId? }`), `LexemesId` (slash-joined lexeme IDs), `Id` (cluster id: `LexemesId/Index-Length` or `Index-Length` when there are no lexemes), `Excluded` (boolean flag for location-specific exclusion).
- **PunctuationData:** `TextRange?` (absent when the entry has no valid `Range`), `BeforeText`, `AfterText`.

### Example (minimal valid document)

```xml
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
```

### Example (full document with optional attributes)

This example shows optional root attributes, verse `Hash`, multiple verses and clusters, multiple lexemes per cluster, lexemes with and without `GlossId`, a cluster with no lexemes, and punctuation entries (with and without `BeforeText`/`AfterText`).

```xml
<?xml version="1.0" encoding="utf-8"?>
<InterlinearData ScrTextName="MyProject" GlossLanguage="en" BookId="RUT">
  <Verses>
    <item>
      <string>RUT 1:1</string>
      <VerseData Hash="A1B2C3D4">
        <Cluster>
          <Range Index="0" Length="3" />
          <Lexeme Id="Word:Now" GlossId="sense-now" />
        </Cluster>
        <Cluster>
          <Range Index="4" Length="7" />
          <Lexeme Id="Stem:come" GlossId="sense-come" />
          <Lexeme Id="Suffix:ing" GlossId="sense-ing" />
        </Cluster>
        <Cluster>
          <Range Index="8" Length="2" />
        </Cluster>
        <Cluster>
          <Range Index="11" Length="4" />
          <Lexeme Id="Word:days" />
        </Cluster>
        <Punctuation>
          <Range Index="7" Length="1" />
          <BeforeText>,</BeforeText>
          <AfterText>;</AfterText>
        </Punctuation>
        <Punctuation>
          <Range Index="15" Length="1" />
        </Punctuation>
      </VerseData>
    </item>
    <item>
      <string>RUT 1:2</string>
      <VerseData>
        <Cluster>
          <Range Index="0" Length="4" />
          <Lexeme Id="Word:name" GlossId="sense-name" />
        </Cluster>
      </VerseData>
    </item>
  </Verses>
</InterlinearData>
```

## Lexicon.xml

### Document structure

- **Root element:** `Lexicon`
  - **Children (all optional):**
    - **`Language`**, **`FontName`**, **`FontSize`** (element text): Informational only — PT9 overwrites all three from project settings on every load.
    - **`Analyses`**: The legacy word-analysis store. PT9 drains it into `WordAnalyses.xml` on read, but projects untouched since PT8 still carry it.
    - **`Entries`**: The lexicon proper.

- **Analyses**
  - **Children:** Zero or more `item` elements.
    - **`string`** (element text): Surface wordform. Required and non-empty; a missing or empty key causes a parse error, and duplicate wordforms cause a parse error.
    - **`ArrayOfLexeme`** (optional): `Lexeme` key elements in morpheme order; absent or empty means no lexemes.

- **Entries**
  - **Children:** Zero or more `item` elements.
    - **`Lexeme`** (required): The entry's key as an attribute triple. A missing key element causes a parse error; duplicate keys (treating an absent `Homograph` as homograph 1) cause a parse error.
      - **Attributes:** `Type` (required, non-empty), `Form` (required; may be empty), `Homograph` (optional; must be a non-negative integer when present, absent is preserved).
    - **`Entry`** (optional): The entry's senses. Absent or empty means an entry with no senses (common for morphemes).

- **Sense**
  - **Attributes:** `Id` (optional): 8 chars of Base64 in PT9-written files, so `+` and `/` are legal. A sense without an id is preserved but cannot be referenced by interlinear data.
  - **Children:** Zero or more `Gloss` elements.

- **Gloss**
  - **Attributes:** `Language` (optional): BCP 47 tag or legacy language name; absent is preserved.
  - **Element text:** The gloss text; an empty element yields an empty string.

### Parsed output (in-memory)

Types exported from `src/parsers/pt9/lexiconXmlParser.ts`: **LexiconData** (`Language?`, `FontName?`, `FontSize?` as raw strings, `Entries`, `Analyses` as a record of wordform → `LexemeKeyData[]`, mirroring how string-keyed PT9 dictionaries parse elsewhere), **LexiconEntryData** (`Key` as a `LexemeKeyData`, `Senses`), **LexiconSenseData** (`Id?`, `Glosses`), **LexiconGlossData** (`Language?`, `Text`). `Entries` stays an array of key-carrying objects because its key is the non-string `LexemeKey`.

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Lexicon>
  <Language>en</Language>
  <FontName>Charis SIL</FontName>
  <FontSize>12</FontSize>
  <Analyses>
    <item>
      <string>exaucera</string>
      <ArrayOfLexeme>
        <Lexeme Type="Stem" Form="exauc" Homograph="1" />
        <Lexeme Type="Suffix" Form="era" Homograph="1" />
      </ArrayOfLexeme>
    </item>
  </Analyses>
  <Entries>
    <item>
      <Lexeme Type="Word" Form="voici" Homograph="1" />
      <Entry>
        <Sense Id="CKVPllxu">
          <Gloss Language="en">is</Gloss>
          <Gloss Language="fr">voici</Gloss>
        </Sense>
      </Entry>
    </item>
    <item>
      <Lexeme Type="Stem" Form="exauc" Homograph="1" />
      <Entry />
    </item>
  </Entries>
</Lexicon>
```

## WordAnalyses.xml

### Document structure

- **Root element:** `WordAnalyses`
  - **Children:** Zero or more `Entry` elements.

- **Entry**
  - **Attributes:** `Word` (required, non-empty): Surface wordform. A missing or empty attribute causes a parse error; duplicate wordforms cause a parse error.
  - **Children:** Zero or more `Analysis` elements — a wordform may carry more than one analysis.

- **Analysis**
  - **Children:** Zero or more `Lexeme` elements whose text is a composed lexeme-key id string (e.g. `Stem:exauc`), in morpheme order.

### Parsed output (in-memory)

Types exported from `src/parsers/pt9/wordAnalysesXmlParser.ts`: **WordAnalysesData** (`Entries`), **WordAnalysesEntryData** (`Word`, `Analyses`), **WordAnalysisData** (`LexemeIds` as the raw id strings).

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<WordAnalyses>
  <Entry Word="exaucera">
    <Analysis>
      <Lexeme>Stem:exauc</Lexeme>
      <Lexeme>Suffix:era</Lexeme>
    </Analysis>
  </Entry>
</WordAnalyses>
```

## InterlinearSetup.xml

### Document structure

- **Root element:** `InterlinearSetupList`
  - **Children:** Zero or more `InterlinearSetup` elements, one per configured gloss language.

- **InterlinearSetup** — every field optional; parsing never throws below the root.
  - **Attributes:**
    - `type`: Interlinear type name (e.g. `"BackTranslation"`, `"Glossing"`, `"Adaptation"`). Kept as the raw string; unknown names from future PT9 versions survive (PT9's own reader throws on them).
    - `language`: Gloss language id; keys the `Interlinear_{language}` directory.
  - **Children (element text):** `LanguageName`, `FontName`, `FontSize` (raw string), `RightToLeft`, `RelatedLanguages`, `ExportOnApprove`, `MdlIsResource` (booleans: `"true"` parses true, any other text false, absent stays absent), `MdlScrTextName`, `MdlScrTextId` (raw hex-id string), `ExportScrTextName`, `ExportScrTextId` (raw hex-id string).

### Parsed output (in-memory)

Types exported from `src/parsers/pt9/interlinearSetupXmlParser.ts`: **InterlinearSetupsData** (`Setups`), **InterlinearSetupData** (all fields optional, attribute `type` → `Type`, attribute `language` → `LanguageId`).

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<InterlinearSetupList>
  <InterlinearSetup type="Glossing" language="en">
    <LanguageName>English</LanguageName>
    <FontName>Charis SIL</FontName>
    <FontSize>12</FontSize>
    <ExportOnApprove>false</ExportOnApprove>
  </InterlinearSetup>
</InterlinearSetupList>
```
