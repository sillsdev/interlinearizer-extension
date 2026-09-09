# Paratext 9 XML schema

PT9 persists interlinear data in four project-local XML files. This document describes their
on-disk format, so that what lies behind the payload `src/converters/pt9/` consumes is legible.
That payload is captured in
[`test-data/Pt9InterlinearProjectData.json`](../../../test-data/Pt9InterlinearProjectData.json),
which the converter's unit tests read directly.

**Whose behavior this describes.** `paranext-core` reads these files and serves the result as
`Pt9InterlinearProjectData` through `platform-scripture`; every behavioral claim below describes
that reader. It reads with PT9's own semantics, never more strictly, with one deliberate
difference: PT9's per-file loads quietly serve an empty file in a corrupt one's place, while one
bad file fails the whole request here. Where this document and that payload's own type
documentation disagree, the type documentation wins.

| File                                                       | Contents                                                      | Lands in                         |
| ---------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------- |
| `Interlinear_{language}/Interlinear_{language}_{book}.xml` | Per-verse cluster selections for one gloss language and book  | `books` (`Pt9InterlinearBook`)   |
| `Lexicon.xml`                                              | Lexicon entries, senses, and gloss text; legacy word analyses | `lexicon` (`Pt9Lexicon`)         |
| `WordAnalyses.xml`                                         | Confirmed wordform-to-parse inventory                         | `wordAnalyses` (`Pt9WordParse`)  |
| `InterlinearSetup.xml`                                     | Per-gloss-language configuration                              | `setups` (`Pt9InterlinearSetup`) |

## Shared conventions

- **Dictionary serialization.** PT9 serializes dictionaries as repeated `item` elements, each
  wrapping the serialized key followed by the serialized value. Verse dictionaries key with a bare
  `<string>` element; the lexicon's `Entries` keys with a `<Lexeme>` element. A duplicate key
  within one dictionary silently keeps the last occurrence, as PT9 does.
- **Lexeme keys.** A lexeme's identity appears either as a composed id string
  (`Type:Form[:Homograph]`, with homograph 1 omitted, e.g. `Word:voici`, `Word:a:2`) or as a
  `<Lexeme Type=".." Form=".." Homograph=".." />` attribute triple. Type names come from PT9's
  append-only list, but they are not equally tolerated: a name PT9 does not know fails the file in
  an attribute triple, while a composed id is passed through unparsed, so an unknown name there
  reaches the consumer. `lexemeKey.ts` converts between the two shapes.
- **Absence is preserved where the payload can express it.** An absent XML attribute stays absent
  on an optional payload field rather than being coalesced to an empty string. A required payload
  field cannot express absence, so it carries whatever PT9's deserializer leaves in it: a missing
  `Range` becomes `(0, 0)`, an absent `Homograph` becomes 1. Where PT9 rejects the missing input
  outright the file fails instead, per the section's own rule.
- **What fails a read.** Unparseable XML, a missing root element, an entry missing its identity, a
  malformed boolean, or an unknown enum name fails the whole file. Duplicate dictionary keys do
  not: the last occurrence wins. Each file section lists its own conditions.

## Interlinear_{language}_{book}.xml

### Document structure

- **Root element:** `InterlinearData`
  - **Attributes:**
    - `GlossLanguage` (expected): Language code or name for glosses (e.g. `"en"`). A file missing it is served with no `glossLanguage`.
    - `BookId` (expected): Book id (e.g. `"MAT"`, `"RUT"`). A file missing it is served with no `bookId`.
    - `ScrTextName` (optional): Source text / project name.
  - **Child:** Exactly one `Verses` element.

- **Verses**
  - **Children:** Zero or more `item` elements. Each `item` represents one verse.
    - **`item`**
      - **`string`** (element text): Verse reference key (e.g. `"MAT 1:1"`, `"RUT 3:1"`). A duplicate reference keeps the last occurrence.
      - **`VerseData`** (optional): If absent, the verse is served with no `approvedHash` and empty `clusters` and `punctuations`.

- **VerseData**
  - **Attributes:**
    - `Hash` (optional): Approval hash of the verse text. PT9 writes it only when the verse is approved, so absence is the not-approved state.
  - **Children:**
    - **`Cluster`** (zero or more): Word/morpheme clusters with range and lexemes.
    - **`Punctuation`** (zero or more): Punctuation change records.

- **Cluster**
  - **Children:**
    - **`Range`** (optional in practice): Character range locating the cluster.
      - **Attributes:** `Index` (start, 0-based), `Length` (number of characters). A missing `Range` element yields range `(0, 0)`, as in PT9; a non-numeric value fails the file.
      - PT9's string for the verse carries the verse marker, so an index sits past the same position in the verse text by the length of the marker PT9 wrote, which grows when the verse carries alternate or published numbering.
      - PT9 does not rewrite stored ranges when the verse text changes, so a project's ranges can point at the wrong text while PT9 still displays its analyses correctly, since it matches an analysis to a word by lexeme form. Treat an index as ordering and a positional hint, never as placement.
    - **`Lexeme`** (zero or more): Lexemes in this cluster.
      - **Attributes:**
        - `Id` (expected): Lexeme id (e.g. from a Lexicon). A `Lexeme` element without one is served with no `lexemeId`.
        - `GlossId` (optional): Id of the selected sense. Absent or empty, the served reference has no `senseId`.
    - **`Excluded`** (optional): Boolean excluding this occurrence from the interlinear display; rarely written. Omitted or `false` means the phrase is included.

- **Punctuation**
  - **Children:**
    - **`Range`** (optional): A missing `Range` yields `(0, 0)` here too.
    - **`BeforeText`** (optional): Punctuation text before the change; omitted stays absent.
    - **`AfterText`** (optional): Punctuation text after the change; omitted stays absent.

### Served payload

One file per gloss language per book, served as `Pt9InterlinearBook` (`platform-scripture`), whose
fields that file's own documentation describes. What that documentation cannot tell you:

- The verse dictionary becomes the `verses` array keyed by `reference`, and `Hash` becomes
  `approvedHash` on each entry.
- Where the same language and book arrive more than once, `convertPt9Project.ts` picks the
  canonical twin by `isCanonicalPath`.
- PT9's `LexemesId` and cluster `Id` are internal to its reader and are not served.

### Example

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
    - **`Language`**, **`FontName`**, **`FontSize`** (element text): Informational only: PT9's own load overwrites all three from project settings.
    - **`Analyses`**: The legacy word-analysis store. PT9 drains it into `WordAnalyses.xml` on read, but projects untouched since PT8 still carry it.
    - **`Entries`**: The lexicon proper.

- **Analyses**
  - **Children:** Zero or more `item` elements.
    - **`string`** (element text, required): Surface wordform. A missing key element fails the file; an empty one is kept as `""`. A duplicate wordform keeps the last occurrence.
    - **`ArrayOfLexeme`** (optional): `Lexeme` key elements in morpheme order; absent or empty means no lexemes.

- **Entries**
  - **Children:** Zero or more `item` elements.
    - **`Lexeme`** (required): The entry's key as an attribute triple. A missing key element fails the file; a duplicate key keeps the last occurrence.
      - **Attributes:** `Type` (expected; an empty or unknown name fails the file, but an absent one silently defaults to `Phrase`), `Form` (required; an empty one is kept as `""`, a missing one fails the file), `Homograph` (optional; must parse as an integer when present, negatives included; absence means homograph 1).
    - **`Entry`** (optional): The entry's senses. Absent or empty means an entry with no senses (common for morphemes).

- **Sense**
  - **Attributes:** `Id` (optional): A sense without an id is preserved but cannot be referenced by interlinear data.
  - **Children:** Zero or more `Gloss` elements.

- **Gloss**
  - **Attributes:** `Language` (optional): BCP 47 tag or legacy language name; absent is preserved.
  - **Element text:** The gloss text; an empty element yields an empty string.

### Served payload

Served as `Pt9Lexicon` (`platform-scripture`). What that type's documentation cannot tell you:

- `Language` is replaced by the project's language id, not the file's value.
- The `Analyses` section becomes `legacyAnalyses`, an empty analysis being dropped.
- Each entry's key is served composed as `id` (`Type:Form[:Homograph]`) alongside its parts.
- `FontName` and `FontSize` are read but not served.
- Entry and analysis forms arrive corrected to the project's Unicode normalization form
  (NFC/NFD); case is preserved.

`Entries` stays an array of key-carrying objects because its key is the non-string `LexemeKey`.

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
  - **Attributes:** `Word` (required): Surface wordform. A missing attribute fails the file; an empty one is kept as `""`. A duplicate wordform keeps the last occurrence.
  - **Children:** Zero or more `Analysis` elements; a wordform may carry more than one analysis.

- **Analysis**
  - **Children:** Zero or more `Lexeme` elements whose text is a composed lexeme-key id string (e.g. `Stem:exauc`), in morpheme order.

### Served payload

Served as `Pt9WordParse[]` (`platform-scripture`). Lexeme ids are passed through as raw strings
here, unparsed, so an id that PT9 itself would reject survives to the consumer.

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

- **InterlinearSetup**
  - **Attributes:**
    - `type`: Interlinear type name, one of `"NotSelected"`, `"BackTranslation"`, `"Glossing"`, `"GlossingWithoutModel"`, `"Adaptation"`. Any other name fails the file.
    - `language`: Gloss language id; keys the `Interlinear_{language}` directory.
  - **Children (element text):**
    - `LanguageName`, `FontName`, `MdlScrTextName`, `ExportScrTextName`: plain strings.
    - `MdlScrTextId`, `ExportScrTextId`: raw hex-id strings.
    - `FontSize`: numeric; non-numeric text fails the file.
    - `RightToLeft`, `RelatedLanguages`, `ExportOnApprove`, `MdlIsResource`: booleans; `"true"` and `"false"` parse, any other text fails the file, absent stays absent.

### Served payload

Served as `Pt9InterlinearSetup[]` (`platform-scripture`). What that type's documentation cannot
tell you:

- The `language` attribute becomes `languageId`, and the `Mdl*` elements become `model*`.
- Setups come from this file merged with the ones PT9 reconstructs from legacy project settings, so
  a setup here may be absent from the payload, and the payload may carry setups this file does not.
- An empty `FontName`, `MdlScrTextName`, or `ExportScrTextName` is served absent; an empty
  `LanguageId` or `LanguageName` is served as `""`. That emptiness handling is the platform
  reader's; `InterlinearSetup` itself stores plain strings with no emptiness logic.

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
