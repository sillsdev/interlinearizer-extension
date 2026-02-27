# Paratext 9 XML schema

The extension reads PT9 interlinear data from XML files (e.g. `Interlinear_<lang>_<book>.xml` in project data). The parser in `src/parsers/paratext-9/interlinearParser.ts` expects the following structure. Sample files live in `test-data/` (e.g. `Interlinear_en_JHN.xml`).

Interlinear XML does **not** store gloss strings; it only references senses by `GlossId` (which corresponds to Sense Id in the Lexicon). To populate `glossText` on the interlinearizer model, the extension can load a Paratext 9 **Lexicon** XML file (`Lexicon.xml`). The Lexicon parser (`src/parsers/paratext-9/lexiconParser.ts`) builds a (senseId, language) → gloss text lookup; `createAnalyses` in `converter` accepts an optional `glossLookup` so analyses get real gloss text when the Lexicon is available.

## Document structure

- **Root element:** `InterlinearData`
  - **Attributes:**
    - `GlossLanguage` (required): Language code or name for glosses (e.g. `"en"`).
    - `BookId` (required): Book id (e.g. `"MAT"`, `"RUT"`).
  - **Child:** Exactly one `Verses` element.

- **Verses**
  - **Children:** Zero or more `item` elements. Each `item` represents one verse.
    - **`item`**
      - **`string`** (element text): Verse reference key (e.g. `"MAT 1:1"`, `"RUT 3:1"`). Must be unique in the document; duplicate references cause a parse error.
      - **`VerseData`** (optional): If absent, the verse is stored with empty `Hash`, `Clusters`, and `Punctuations`.

- **VerseData**
  - **Attributes:**
    - `Hash` (optional): Approval hash of the verse text when approved; empty if not approved.
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
        - `GlossId` (optional): Sense/gloss id; omitted or empty is treated as empty string.
    - **`Excluded`** (optional): Boolean flag indicating this instance of a phrase should be excluded from the interlinear display at this specific location. This is a very niche property that is included because it's possible to be present in the XML, even though it's rarely used. When `true`, the phrase is not displayed at this location but remains available elsewhere. The exclusion is location-specific (applies to this instance at this text range, not globally). Omitted or `false` means the phrase is included.

- **Punctuation**
  - **Children:**
    - **`Range`** (optional): If present, must have numeric `Index` and `Length`. Entries without a valid `Range` are skipped (not an error).
    - **`BeforeText`** (optional): Punctuation text before the change; omitted → empty string.
    - **`AfterText`** (optional): Punctuation text after the change; omitted → empty string.

## Parsed output (in-memory)

The parser produces objects conforming to the types in `src/parsers/paratext-9/types.ts`:

- **InterlinearData:** `glossLanguage`, `bookId`, `verses` (record of verse key → **VerseData**).
- **VerseData:** `hash`, `clusters` (array of **ClusterData**), `punctuations` (array of **PunctuationData**).
- **ClusterData:** `textRange` (`index`, `length`), `lexemes` (array of **LexemeData** `{ lexemeId, senseId }`), `lexemesId` (slash-joined lexeme IDs), `id` (cluster id: `lexemesId/index-length` or `index-length` when there are no lexemes), `excluded` (boolean flag for location-specific exclusion).
- **PunctuationData:** `textRange`, `beforeText`, `afterText`.

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
<InterlinearData GlossLanguage="en" BookId="RUT">
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

## Lexicon XML (gloss text lookup)

The Lexicon file (`Lexicon.xml`) provides gloss text per Sense and language. Structure:

- **Root element:** `Lexicon`
  - **Child:** `Entries` containing `item` elements (one per lexicon entry).
- **`item`**
  - **`Lexeme`** (optional): Attributes `Type`, `Form`, `Homograph` (for reference; not used for lookup).
  - **`Entry`**: Contains **`Sense`** elements.
- **`Sense`**
  - **Attribute:** `Id` (required). This Id is the same as `GlossId` in Interlinear XML.
  - **Children:** One or more **`Gloss`** elements.
- **`Gloss`**
  - **Attribute:** `Language` (e.g. `"en"`, `"hbo"`, `"grc"`). The gloss language in InterlinearData should match when resolving word-level glosses.
  - **Text content:** The gloss string (may be empty).

The converter uses `parseLexiconAndBuildGlossLookup(xml)` to build a function `(senseId, language) => glossText`. Pass that function as `createAnalyses(interlinearData, { glossLookup })` so `Analysis.glossText` is set from the Lexicon instead of the senseId placeholder.
