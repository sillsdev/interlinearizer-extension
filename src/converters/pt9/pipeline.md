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

## The whole conversion

One payload arrives and splits three ways. The `books` lane is a four-step chain producing analyses
anchored to real occurrences in the text; the `wordAnalyses` lane is a single step producing
payloads that describe a spelling and carry no links. Both query the lexicon, and both converge on
one `TextAnalysis`.

```mermaid
flowchart TD
  IN[/"Pt9InterlinearProjectData"/]
  IN -->|books| A1["1 · dedupe books<br/>convertPt9Project.ts"]
  IN -->|lexicon| LEX["gloss index<br/>pt9GlossSource.ts"]
  IN -->|"wordAnalyses + legacyAnalyses"| B1["5 · bare payloads<br/>bareWordAnalyses.ts"]

  A1 --> A2["2 · group and tag languages<br/>glossLanguageTags.ts"]
  A2 -->|per language and book| A3["3 · per-language records<br/>languageAnalysisBuilder.ts<br/>clusterAnchoring.ts"]
  TEXT[/"Book[] · text layer"/] --> A3
  A3 -->|"LangTokenRecord<br/>LangPhraseRecord"| A4["4 · merge languages<br/>analysisMerger.ts"]

  LEX -.-> A3
  LEX -.-> B1
  A4 -.->|clusterParseIdentities| B1

  A4 -->|"tokenAnalyses + links<br/>phraseAnalyses + links"| OUT[/"TextAnalysis<br/>analysisLanguages<br/>Pt9ImportReport"/]
  B1 -->|"tokenAnalyses, no links"| OUT
```

## Inside stage 3, for one book of one gloss language

Stage 3 is where nearly every drop happens. Cluster type is derived, never stored — PT9 persists
only the lexeme ids — and anchoring runs on folded forms rather than the stored offsets, which index
PT9's marker-bearing USFM and cannot be applied to the segment's baseline text.

```mermaid
flowchart TD
  V[/"one book's verses, one gloss language"/] --> VK{"verse key matches<br/>a segment?"}
  VK -->|no| D0(["dropped · verseNotFound"])
  VK -->|yes| C{"classify each cluster<br/>by its lexeme ids"}

  C -->|"Stem, Prefix, Suffix"| P["word parse"]
  C -->|single Word| W["word"]
  C -->|single Phrase| H["phrase"]
  C -->|"Lemma, Other,<br/>unparseable id"| D1(["dropped · lemmaOrOther<br/>unparseableLexemeId"])

  P --> AN["anchor by folded form, in order<br/>clusterAnchoring.ts"]
  W --> AN
  H --> AN

  AN -->|"no token folds to it"| D2(["dropped · formMismatch"])
  AN -->|"a second of its kind<br/>at one range"| D3(["dropped · duplicateCluster"])
  AN -->|"word and parse at one<br/>range anchor together"| G["resolve gloss<br/>pt9GlossSource.ts"]

  G --> S["status from the verse approval hash<br/>present = approved, absent = suggested"]
  S --> R[/"LangTokenRecord · LangPhraseRecord"/]
```

## Stages

**1. Dedupe books** — `convertPt9Project.ts`

Keeps one book per gloss language and book id. Drops books carrying neither, and non-canonical
twins of a book already seen; the twin PT9's own reader loads wins, read off the served
`isCanonicalPath`.

**2. Group and tag languages** — `convertPt9Project.ts`, `glossLanguageTags.ts`

Groups the surviving books by raw `GlossLanguage` and resolves the BCP 47 tag each group's glosses
are keyed by. Drops nothing: an untaggable value passes through verbatim, flagged as a fallback, and
two raw values colliding on one tag are recorded rather than merged silently.

**3. Build per-language records** — `languageAnalysisBuilder.ts`, `clusterAnchoring.ts`

Diagrammed above. Runs once per language per book, and needs that book's text layer; a book the
source project has no text for converts nothing and is reported as `bookFound: false`.

**4. Merge languages** — `analysisMerger.ts`

Folds every language's contributions into one record per token, parse, and phrase. Languages that
agree on a lexeme sequence merge onto one record with `MultiString` glosses; ones that genuinely
disagree become competing records rather than losses. Also enforces one approved record per token,
demoting the rest to candidate, and returns `clusterParseIdentities` so stage 5 can skip what it
already produced.

**5. Build bare payloads** — `bareWordAnalyses.ts`

Turns `data.wordAnalyses` and the lexicon's legacy analyses into occurrence-free token analyses that
describe a spelling and carry no links. Deduplicates by word plus key signature. Drops empty and
unparseable parses, and anything stage 4 already converted.

**The gloss index** — `pt9GlossSource.ts`

Not a stage in the chain but a lookup both lanes query: gloss text by composed entry id, sense
selection, and language. Answers `specific`, `defaultSingle`, or `none`, never replicating PT9's
guessing among several glossed senses.

Stages 4 and 5 are the only ones that mint lexicon references, and both do it through the
`Pt9LexiconResolver` seam rather than constructing refs themselves — a seam nothing in #272 or its
stack supplies, so today every reference comes out unresolved. Every stage accumulates onto the one
`Pt9ImportReport` described in `report.ts`, so what a conversion dropped is always countable.
