# PT9 conversion pipeline

`convertPt9Project` turns one project's Paratext 9 interlinear data into the extension's analysis
layer. It is a pure function: the platform reads and parses the XML with PT9's own semantics and
serves a `Pt9InterlinearProjectData`, and nothing in this directory touches a file. The XML behind
that payload is documented in [pt9-xml.md](../../parsers/pt9/pt9-xml.md).

> [!IMPORTANT]
> **This describes #272, and this branch is not #272.** The ten files it cites live in
> `src/converters/pt9/` on the `pt9-parsed-converter` branch; none of them exist in the tree around
> this file, and the parsers it replaces are still present under `src/parsers/pt9/`. Read it against
> that PR.

```mermaid
flowchart TD
  IN1["Pt9InterlinearProjectData<br/>served by platformScripture.Pt9Interlinear"]
  IN2["Book[]<br/>the source project's text layer"]
  RES["Pt9LexiconResolver<br/>defaults to resolving nothing"]

  IN1 --> S1["1. identify and dedupe books<br/>convertPt9Project.ts"]
  S1 --> S2["2. group by gloss language, resolve tag<br/>glossLanguageTags.ts"]
  IN1 -. "lexicon" .-> S3["3. index lexicon glosses by composed entry id<br/>pt9GlossSource.ts"]

  S2 --> S4["4. per language and book: classify, anchor, resolve glosses<br/>languageAnalysisBuilder.ts, clusterAnchoring.ts"]
  IN2 --> S4
  S3 -.-> S4

  S4 -->|"LangTokenRecord, LangPhraseRecord"| S5["5. merge languages onto shared tokens and parses<br/>analysisMerger.ts"]
  S5 -->|"clusterParseIdentities"| S6["6. build unlinked wordform payloads<br/>bareWordAnalyses.ts"]
  IN1 -. "wordAnalyses, legacy analyses" .-> S6
  S3 -.-> S6
  RES -.-> S5
  RES -.-> S6

  S5 --> OUT["TextAnalysis, analysisLanguages, Pt9ImportReport"]
  S6 --> OUT
```

## Stages

**1. Identify and dedupe books** — `convertPt9Project.ts`

Keeps one book per gloss language and book id. Drops books carrying neither, and non-canonical
twins of a book already seen; the twin PT9's own reader loads wins.

**2. Group and tag languages** — `convertPt9Project.ts`, `glossLanguageTags.ts`

Groups the surviving books by raw `GlossLanguage` and resolves the BCP 47 tag each group's glosses
are keyed by. Drops nothing: an untaggable value passes through verbatim, flagged as a fallback.

**3. Index the lexicon** — `pt9GlossSource.ts`

Builds gloss lookups over `data.lexicon`, keyed by the served composed entry id, answering for a
lexeme, a sense selection, and a language. Drops nothing.

**4. Build per-language records** — `languageAnalysisBuilder.ts`, `clusterAnchoring.ts`

Classifies and anchors one book of one language onto its text layer, resolving each lexeme's gloss,
and emits token and phrase contributions with status from the verse approval hash. Drops clusters
that classify as inert or anchor to nothing, counted by `Pt9ClusterDropReason`.

**5. Merge languages** — `analysisMerger.ts`

Folds every language's contributions into one record per token, parse, and phrase, with
`MultiString` glosses and their links. Drops nothing: genuinely conflicting parses become competing
records rather than losses.

**6. Build bare payloads** — `bareWordAnalyses.ts`

Turns `data.wordAnalyses` and the lexicon's legacy analyses into occurrence-free token analyses that
describe a spelling and carry no links. Drops empty and unparseable parses, and anything stage 5
already converted.

Stages 5 and 6 are the only ones that mint lexicon references, and both do it through the
`Pt9LexiconResolver` seam rather than constructing refs themselves. Every stage accumulates onto the
one `Pt9ImportReport` described in `report.ts`, so what a conversion dropped is always countable.
