# Paratext 9 XML schema

The extension reads PT9 interlinear data from XML files (e.g. `Interlinear_<lang>_<book>.xml` in project data). The parser in `src/parsers/pt9/interlinearXmlParser.ts` expects the following structure. Sample files live in `test-data/` (e.g. `Interlinear_en_MAT.xml`).

## Document structure

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
    - **`Range`** (optional): Every Punctuation entry is preserved. `TextRange` is set only when `Range` is present with non-negative integer `Index` and `Length`; otherwise the entry has no `TextRange`. (PT9 itself reads a missing `Range` as a `(0, 0)` default; the parser preserves absence instead of fabricating a range.)
    - **`BeforeText`** (optional): Punctuation text before the change; omitted → empty string.
    - **`AfterText`** (optional): Punctuation text after the change; omitted → empty string.

## Parsed output (in-memory)

The parser produces objects conforming to the types exported from `src/parsers/pt9/interlinearXmlParser.ts`. Optional data is preserved losslessly: absent XML attributes stay absent on the output objects rather than being coalesced to empty strings.

- **InterlinearData:** `ScrTextName?` (absent when the legacy attribute is missing), `GlossLanguage`, `BookId`, `Verses` (record of verse key → **VerseData**).
- **VerseData:** `Hash?` (absent means the verse is not approved), `Clusters` (array of **ClusterData**), `Punctuations` (array of **PunctuationData**).
- **ClusterData:** `TextRange` (`Index`, `Length`), `Lexemes` (array of `{ LexemeId, SenseId? }`), `LexemesId` (slash-joined lexeme IDs), `Id` (cluster id: `LexemesId/Index-Length` or `Index-Length` when there are no lexemes), `Excluded` (boolean flag for location-specific exclusion).
- **PunctuationData:** `TextRange?` (absent when the entry has no valid `Range`), `BeforeText`, `AfterText`.

## Example (minimal valid document)

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
