/**
 * @file Extension type declaration file. Platform.Bible shares this with other extensions. Types
 *   exposed here (and in papi-shared-types) are available to other extensions.
 */
/**
 * Interlinearizer Interlinear Model
 *
 * A representation for interlinear data that should cover import from LCM (FieldWorks), Paratext 9,
 * and BT Extension and support the new interlinearizer.
 *
 * Shape at a glance:
 *
 *     InterlinearAlignment
 *     ├─ source : InterlinearText    — the input being analyzed
 *     ├─ target : InterlinearText    — the analysis / output side
 *     └─ links  : AlignmentLink[]
 *
 *     InterlinearText
 *     ├─ books    : Book[]           — text layer (baseline)
 *     │    └─ Segment[] → Token[]
 *     └─ analysis : TextAnalysis     — analysis layer (flat)
 *          ├─ segmentAnalyses : SegmentAnalysis[]    (per-segment translations)
 *          ├─ tokenAnalyses   : TokenAnalysis[]      (parse + 1:1 gloss)
 *          └─ phrases         : Phrase[]             (multi-token gloss)
 *
 * The analysis layer is **flat** — not a mirror of the text layer's book / segment nesting. Every
 * analysis record carries an id reference back to its text-layer counterpart (`segmentId` /
 * `tokenId`). Consumers index by id at load time (`Map<tokenId, TokenAnalysis[]>`, etc.) to render
 * a segment at a time. This keeps the layer's containers honest — none exist just to mirror a
 * parent — and makes it trivial to add analyses without touching the text hierarchy.
 *
 * Lexical information (entries, senses, allomorphs, grammar / MSA, …) is **not** stored in this
 * model. It lives in the Lexicon extension (`lexicon`); this model references it via `EntryRef` /
 * `SenseRef` / `AllomorphRef` / `GrammarRef`. Where the Lexicon extension does not yet surface a
 * referenced type or provide a lookup method (see the per-ref "Current Lexicon gap" notes below),
 * this model is the standard and the extension is expected to add what's missing. Summary of gaps:
 *
 * - `IEntryService` has no by-id lookup for entries.
 * - No sense-level service method — senses resolved via entry walk.
 * - `IMoForm` (allomorph) is not exported; no allomorph service.
 * - `IMoMorphSynAnalysis` (MSA) is not exported; no MSA service.
 *
 * Punctuation tokens are first-class citizens of the text layer on both source and target sides —
 * they are stored in `Segment.tokens` so the baseline text can be reconstructed faithfully. They
 * are simply omitted from the analysis layer's `tokenAnalyses` (rather than stored there with empty
 * analyses).
 *
 * Staleness detection: analysis records and alignment endpoints carry a `tokenSnapshot` of the
 * token's surface text at analysis time. When the baseline changes, consumers compare the snapshot
 * against the current `Token.surfaceText` and flip `status` to `Stale` on mismatch to prompt
 * re-review.
 */
declare module 'interlinearizer' {
  // ---------------------------------------------------------------------------
  // Enums
  // ---------------------------------------------------------------------------

  /** Whether a token holds a word or punctuation. */
  export const enum TokenType {
    Word = 'word',
    Punctuation = 'punctuation',
  }

  /**
   * How an analysis was produced.
   *
   * - `high` — human-created or human-confirmed
   * - `medium` — tool-assisted, reasonably confident
   * - `low` — tool-assisted, low certainty
   * - `guess` — unreviewed machine suggestion
   */
  export const enum Confidence {
    Guess = 'guess',
    Low = 'low',
    Medium = 'medium',
    High = 'high',
  }

  /**
   * Lifecycle status of a token analysis, phrase, or alignment link.
   *
   * - `approved` — human-confirmed
   * - `suggested` — machine-generated or unreviewed
   * - `candidate` — proposed but not yet reviewed
   * - `rejected` — explicitly rejected by a human
   * - `stale` — the underlying token text has changed since this record was created; the record needs
   *   human review. Set by drift-detection logic comparing `tokenSnapshot` against the current
   *   `Token.surfaceText`.
   */
  export const enum AssignmentStatus {
    Approved = 'approved',
    Suggested = 'suggested',
    Candidate = 'candidate',
    Rejected = 'rejected',
    Stale = 'stale',
  }

  // ---------------------------------------------------------------------------
  // Shared primitives
  // ---------------------------------------------------------------------------

  /** A string value keyed by BCP 47 writing-system tag. */
  export type MultiString = Record<string, string>;

  /**
   * A character-level scripture reference anchored to a specific position within a verse's baseline
   * text. When `charIndex` is absent the reference is verse-level only.
   */
  export interface ScriptureRef {
    book: string;
    chapter: number;
    verse: number;
    /** Zero-based character offset within the verse's baseline text. */
    charIndex?: number;
  }

  // ---------------------------------------------------------------------------
  // Lexicon references (Lexicon extension: `lexicon`)
  // ---------------------------------------------------------------------------

  /**
   * Reference to an `IEntry` in the Lexicon extension.
   *
   * Resolving an `EntryRef` requires the Lexicon extension's entry service, registered as the
   * `lexicon.entryService` network object (typed `lexicon.IEntryService` in
   * platform.bible-extension's `lexicon.d.ts`). `projectId` identifies which Lexicon project owns
   * the entry; it may be omitted when a single project context is implied.
   *
   * **Current Lexicon gap:** `IEntryService.getEntries` queries by surface form / POS / semantic
   * domain — there is no by-id lookup. Resolving an `EntryRef` today means a query + client-side id
   * filter. A `getEntry(projectId, entryId)` method on the service would close the gap.
   */
  export interface EntryRef {
    /** `IEntry.id` (GUID). */
    entryId: string;

    /** Lexicon project identifier (FwData / Harmony code). */
    projectId?: string;
  }

  /**
   * Reference to an `ISense` in the Lexicon extension.
   *
   * **Current Lexicon gap:** `IEntryService` exposes no sense-level methods. A `getSense(projectId,
   * senseId)` method on the service is needed to resolve this ref. Without it, consumers must
   * enumerate entries to find the matching sense — which is fragile and does not handle the edge
   * case where a sense is moved to a different entry.
   */
  export interface SenseRef {
    /** `ISense.id` (GUID). */
    senseId: string;

    /** Lexicon project identifier (FwData / Harmony code). */
    projectId?: string;
  }

  /**
   * Reference to a specific allomorph (`IMoForm`) on an `IEntry` in the Lexicon extension.
   *
   * Allomorphs are surface variants of a lexical form (e.g. the English plural `-es` vs. `-s`).
   *
   * **Current Lexicon gaps:**
   *
   * - `IMoForm` is not exported from the Lexicon extension's public types — there is no typed surface
   *   for allomorphs. Detail can only be inferred indirectly via `IEntry.lexemeForm` and
   *   `IEntry.components`.
   * - `IEntryService` exposes no allomorph methods.
   *
   * The extension is expected to surface `IMoForm` and add a `getAllomorph(projectId, allomorphId)`
   * method (or equivalent) so `AllomorphRef` can be resolved directly.
   */
  export interface AllomorphRef {
    /** `IMoForm.id` (GUID). */
    allomorphId: string;

    /** Lexicon project identifier (FwData / Harmony code). */
    projectId?: string;
  }

  /**
   * Reference to a morphosyntactic analysis (`IMoMorphSynAnalysis`, MSA) in the Lexicon extension.
   *
   * An MSA ties grammatical information — part of speech, inflection class, stem features — to a
   * specific (entry × sense × allomorph) usage.
   *
   * **Current Lexicon gaps:**
   *
   * - `IMoMorphSynAnalysis` is not exported from the Lexicon extension's public types — there is no
   *   typed surface for MSAs at all.
   * - `IEntryService` exposes no MSA methods.
   *
   * The interlinear model is the standard that requires this surface; the extension is expected to
   * add `IMoMorphSynAnalysis` and a `getMsa(projectId, msaId)` method (or equivalent) so
   * `GrammarRef` can be resolved.
   */
  export interface GrammarRef {
    /** `IMoMorphSynAnalysis.id` (GUID). */
    msaId: string;

    /** Lexicon project identifier (FwData / Harmony code). */
    projectId?: string;
  }

  // ---------------------------------------------------------------------------
  // §1 InterlinearAlignment
  // ---------------------------------------------------------------------------

  /**
   * Top-level bilingual container pairing two interlinear texts — `source` (the input being
   * analyzed) and `target` (the analysis / output side) — with the alignment links between them.
   *
   * The sides carry directional meaning: `source` is what the workflow takes in, `target` is what
   * the workflow produces or aligns toward. The model types themselves are identical on both sides;
   * that directional contract is enforced by the application layer, not by shape. Example
   * pairings:
   *
   * - Glossing a vernacular draft (source) in an analyst language such as English (target);
   * - Aligning a Greek / Hebrew resource text (source) against a vernacular translation (target);
   * - Aligning one translation (source) against another (target).
   *
   * Each side carries its own text (books → segments → tokens) and, optionally, a flat analysis
   * layer (`segmentAnalyses` / `tokenAnalyses` / `phrases`). `AlignmentLink`s bridge tokens or
   * morphemes from source to target.
   *
   * Source-system mapping:
   *
   * - LCM: no native bilingual alignment model. Constructed by pairing two `InterlinearText`
   *   instances produced from LCM / companion data; the workflow decides which is `source` and
   *   which is `target`.
   * - Paratext: not directly represented. Can be constructed from parallel projects that share the
   *   same versification.
   * - BT Extension: one `Translation` scoped to two sides (`Translation.sideNum`: 1 / 2). By BT
   *   convention side 1 is the source and side 2 is the target; each side becomes an
   *   `InterlinearText`. `Alignment` records become `AlignmentLink`s.
   */
  export interface InterlinearAlignment {
    id: string;

    /**
     * The input being analyzed — for example a vernacular draft being glossed, a Greek / Hebrew
     * resource text being aligned against a translation, or one translation being aligned against
     * another.
     */
    source: InterlinearText;

    /**
     * The analysis / output side — for example an analyst-language gloss, a back translation, or
     * the translation being aligned against the source.
     */
    target: InterlinearText;

    /**
     * Token- or morpheme-level alignment links connecting endpoints in the source interlinear to
     * endpoints in the target interlinear.
     */
    links: AlignmentLink[];
  }

  // ---------------------------------------------------------------------------
  // §2 InterlinearText
  // ---------------------------------------------------------------------------

  /**
   * One side of an interlinear alignment — the baseline text plus its parallel analysis layer.
   *
   * The text layer (`books`) mirrors the underlying document's structure. The analysis layer
   * (`analysis`) has the same divisions but carries morpheme / gloss / phrase information and
   * references into the Lexicon extension.
   *
   * Source-system mapping:
   *
   * - LCM: one `IScripture` instance (singleton per project). Text layer from `IScrBook` /
   *   `IScrSection` / `IScrTxtPara` content; analysis layer from `IWfiWordform` / `IWfiAnalysis` /
   *   `IWfiGloss` referenced by `ISegment.AnalysesRS`. `analysisLanguages[]` is the set of
   *   languages present on `IWfiGloss.Form`.
   * - Paratext: merged from per-book, per-language `InterlinearData` files
   *   (`Interlinear_{language}/Interlinear_{language}_{book}.xml`). Text layer from USFM; analysis
   *   layer from `ClusterData` + `LexemeCluster` + `WordAnalysis`. Each file's `GlossLanguage` is
   *   added to `analysisLanguages[]`.
   * - BT Extension: one side of a `Translation` (a single `sideNum` value). Text layer from `Token` /
   *   `Instance` records; analysis layer synthesized from per-token `gloss` / `lemmaText` /
   *   `senseIds`. Analysis is typically in a single language.
   */
  export interface InterlinearText {
    id: string;

    /** Writing system of the baseline text. */
    writingSystem: string;

    /**
     * Writing systems in which analyses are provided (e.g. `["en", "fr"]`). A single text can hold
     * analyses in multiple languages.
     */
    analysisLanguages: string[];

    /** Baseline text: books of scripture (or other texts). */
    books: Book[];

    /** Parallel analysis layer. Omitted when the text is unanalyzed. */
    analysis?: TextAnalysis;
  }

  // ---------------------------------------------------------------------------
  // §3 Text layer — Book, Segment, Token
  // ---------------------------------------------------------------------------

  /**
   * One book of scripture (or other text unit).
   *
   * `textVersion` is a hash or version stamp of the book's baseline content at analysis time — used
   * to detect when the underlying text has changed and analyses may be stale.
   *
   * Source-system mapping:
   *
   * - LCM: `IScrBook`. `bookRef` = `IScrBook.BookId` (3-letter SIL code from `CanonicalNum`).
   *   `textVersion` from `IScrBook.ImportedCheckSum` or a hash of paragraph contents.
   * - Paratext: book-level data in `InterlinearData` (one file per book per language, merged).
   *   `textVersion` derived from `VerseData.Hash` values across the book's verses.
   * - BT Extension: one book within a `Translation`. `textVersion` not natively tracked; synthesized
   *   from token checksums at import time.
   */
  export interface Book {
    id: string;

    /** Book identifier (e.g. `"GEN"`, `"MAT"`). */
    bookRef: string;

    /** Version stamp of the baseline content at analysis time. */
    textVersion: string;

    /** Ordered segments that compose this book. */
    segments: Segment[];
  }

  /**
   * A range of text within a book — a sentence, clause, or verse — which contains an ordered
   * sequence of tokens.
   *
   * Source-system mapping:
   *
   * - LCM: `ISegment` owned by `IScrTxtPara` within `IScrSection`. `startRef` / `endRef` derived from
   *   `IScrSection.VerseRefStart` (BBCCCVVV) plus `ISegment.BeginOffset` / `EndOffset`.
   *   `baselineText` = `ISegment.BaselineText`.
   * - Paratext: a verse (`VerseRef`) within `VerseData`. `startRef` / `endRef` derived from the verse
   *   reference (with optional character offsets). `baselineText` is the verse USFM content.
   * - BT Extension: a `Verse` (BCV identifier). `baselineText` reconstructed from `Token.before` +
   *   `Token.text` + `Token.after`.
   */
  export interface Segment {
    id: string;

    /** Inclusive start of the text range, anchored to a character position within its verse. */
    startRef: ScriptureRef;

    /** Inclusive end of the text range, anchored to a character position within its verse. */
    endRef: ScriptureRef;

    /**
     * Raw text of the segment. Required — token character offsets (`Token.charStart` /
     * `Token.charEnd`) are expressed relative to this string, so it must be present for the text
     * layer to be interpretable, particularly for scriptio continua scripts where token boundaries
     * are not derivable from whitespace.
     */
    baselineText: string;

    /**
     * Ordered tokens in this segment — both words **and** punctuation. Punctuation tokens are
     * stored here (in the text layer) alongside word tokens so the baseline text can be
     * reconstructed faithfully; they are only omitted from the analysis layer (see
     * `TextAnalysis.tokenAnalyses`).
     */
    tokens: Token[];
  }

  /**
   * A single word or punctuation unit at a specific position in the baseline text. Tokens carry no
   * linguistic analysis — that lives in the parallel `TokenAnalysis` within the analysis layer.
   *
   * `charStart` and `charEnd` express the token's position as zero-based character offsets within
   * the owning `Segment.baselineText` (`charEnd` is exclusive — one past the last character). These
   * fields are essential for scriptio continua scripts (Chinese, Thai, Tibetan, Lao, Burmese, …)
   * where word boundaries are not marked by whitespace and the tokenization decision is itself a
   * linguistic artifact that must be preserved. For whitespace-delimited scripts the fields are
   * still required: they allow faithful reconstruction and precise drift detection when the
   * baseline changes without relying on surface-text scanning.
   *
   * Invariant: `Segment.baselineText.slice(charStart, charEnd) === surfaceText`.
   *
   * Source-system mapping:
   *
   * - LCM: the `ITsString` span at an `ISegment.AnalysesRS` index. `type` = `word` when the analysis
   *   references `IWfiWordform` / `IWfiAnalysis` / `IWfiGloss`, `punctuation` when it references
   *   `IPunctuationForm`. `charStart` / `charEnd` derived from the run boundaries of the
   *   `ITsString` within `ISegment.BaselineText`.
   * - Paratext: a `ClusterData` entry (`type = word`) or a `PunctuationData` entry (`type =
   *   punctuation`) within `VerseData`. `surfaceText` = the text span identified by
   *   `ClusterData.TextRange` / `PunctuationData.TextRange`. `charStart` / `charEnd` derived from
   *   `TextRange`, offset by the segment's start position within the verse baseline.
   * - BT Extension: a `Token` (API) / `Instance` (DB). `surfaceText` = `Token.text` /
   *   `Instance.instanceText`. `type` is always `word` — BT Extension does not model punctuation
   *   tokens. `charStart` / `charEnd` reconstructed from the cumulative lengths of preceding
   *   tokens' `before` + `text` + `after` spans; not natively stored as a character offset.
   */
  export interface Token {
    id: string;

    /** The token's text as it appears in the baseline. */
    surfaceText: string;

    /** Writing system of `surfaceText`. */
    writingSystem: string;

    /** Whether this token is a word or punctuation. */
    type: TokenType;

    /**
     * Zero-based start offset of this token within the owning `Segment.baselineText`. Together with
     * `charEnd`, uniquely locates the token in the baseline regardless of script type.
     */
    charStart: number;

    /**
     * Exclusive end offset of this token within the owning `Segment.baselineText` — one past the
     * last character. `baselineText.slice(charStart, charEnd)` must equal `surfaceText`.
     */
    charEnd: number;
  }

  // ---------------------------------------------------------------------------
  // §4 Analysis layer — TextAnalysis, SegmentAnalysis
  // ---------------------------------------------------------------------------

  /**
   * The analysis layer for an `InterlinearText`.
   *
   * Flat by design — it does **not** mirror the text layer's book / segment nesting. Every record
   * carries an id reference back to its text-layer counterpart (`segmentId` / `tokenId`). Consumers
   * that need segment-local views build `Map<segmentId, …>` / `Map<tokenId, TokenAnalysis[]>` at
   * load time.
   *
   * Keeping this layer flat avoids ceremonial container types whose only purpose is to mirror a
   * parent, and makes it trivial to add or remove analyses without touching the text hierarchy.
   *
   * Source-system mapping:
   *
   * - LCM: the set of `IWfiAnalysis` / `IWfiGloss` referenced by `ISegment.AnalysesRS` across all
   *   Scripture segments.
   * - Paratext: `LexemeCluster` / `WordAnalysis` data across the merged `InterlinearData` files (all
   *   books, all languages).
   * - BT Extension: per-token `gloss` / `lemmaText` / `senseIds` across the `Translation` side.
   */
  export interface TextAnalysis {
    /**
     * Per-segment analysis records, keyed to `Segment.id` via `segmentId`. Carries only
     * segment-level data (free / literal translations); token-level data lives in `tokenAnalyses`.
     *
     * Competing analyses are permitted: a single `segmentId` may have multiple `SegmentAnalysis`
     * entries (e.g. an AI-drafted back translation alongside a human-edited one), distinguished by
     * `status` / `confidence` / `producer`.
     *
     * **Invariant:** at most one `SegmentAnalysis` per `segmentId` has `status: Approved`. That
     * entry is the canonical segment-level analysis for rendering; alternates are available to
     * review workflows via the other statuses.
     */
    segmentAnalyses: SegmentAnalysis[];

    /**
     * Token-level analyses, flat across the whole text. Each entry references its token by
     * `tokenId`; the text layer keeps every token (words and punctuation) but this list typically
     * includes only the tokens being analyzed — punctuation is omitted rather than stored with
     * empty analyses.
     *
     * Competing analyses are permitted: a single `tokenId` may have multiple `TokenAnalysis`
     * entries (e.g. a parser's suggestion alongside a human's choice), distinguished by `status` /
     * `confidence` / `producer`.
     *
     * **Invariant:** at most one `TokenAnalysis` per `tokenId` has `status: Approved`. That entry
     * is the canonical analysis for rendering; alternates are available to review workflows via the
     * other statuses (`Suggested`, `Candidate`, `Rejected`, `Stale`).
     */
    tokenAnalyses: TokenAnalysis[];

    /**
     * Multi-token phrase analyses, flat across the whole text. A phrase may group adjacent or
     * disjoint tokens and carries its own gloss. A phrase's member tokens may span multiple
     * segments.
     *
     * Competing phrases are permitted: a given `tokenId` may appear in multiple `Phrase` records
     * (e.g. a suggested phrase grouping plus a human-approved one) distinguished by `status`.
     *
     * **Invariants:**
     *
     * - At most one `Phrase` containing a given `tokenId` has `status: Approved`. That phrase is
     *   canonical for rendering.
     * - A token may carry both a `TokenAnalysis` _and_ an approved `Phrase`; the per-token parse
     *   coexists with the phrase-level gloss and is not a competing analysis.
     */
    phrases: Phrase[];
  }

  /**
   * Per-segment analysis record. Carries data that belongs to a segment as a whole (free / literal
   * translations). Token analyses and phrases live on `TextAnalysis` directly, keyed by id.
   *
   * Source-system mapping:
   *
   * - LCM: one `ISegment`'s segment-level data. `freeTranslation` = `ISegment.FreeTranslation`
   *   (multi-string). `literalTranslation` = `ISegment.LiteralTranslation`.
   * - Paratext: free / literal translations are not stored in Paratext interlinear data — this record
   *   is typically absent for Paratext-origin analyses unless synthesized.
   * - BT Extension: free / literal translations are not natively stored — typically absent unless
   *   synthesized.
   */
  export interface SegmentAnalysis {
    id: string;

    /** Reference to the corresponding `Segment.id` in the text layer. */
    segmentId: string;

    /** Idiomatic translation of the segment. */
    freeTranslation?: MultiString;

    /** Word-for-word translation. May be generated from token glosses. */
    literalTranslation?: MultiString;

    /**
     * How much to trust this segment-level analysis. Independent of who produced it — see
     * `producer` / `sourceUser` for that.
     */
    confidence?: Confidence;

    /** Required review status. */
    status: AssignmentStatus;

    /**
     * Free-form tag identifying what produced this analysis — e.g. `"human"`, `"bt-draft"`, or a
     * specific tool name.
     */
    producer?: string;

    /**
     * User identifier for human-created or human-edited analyses. Omitted for purely
     * machine-generated entries.
     */
    sourceUser?: string;
  }

  // ---------------------------------------------------------------------------
  // §5 TokenAnalysis — parse + 1:1 gloss
  // ---------------------------------------------------------------------------

  /**
   * Analysis of a single token: a word-level (1:1) gloss plus optional morpheme-level parse.
   *
   * `gloss` is a free-form gloss string for the token (keyed by analysis-language tag).
   * `glossSenseRef` alternatively resolves the gloss through a specific `ISense` in the Lexicon
   * extension — when set, the rendered gloss is the sense's gloss text and may be refreshed
   * automatically if the lexicon is edited. Setting both is a type error: use one or the other.
   *
   * `morphemes` carries the parse information. Each morpheme links to the Lexicon extension via
   * `entryRef` / `senseRef`.
   *
   * Source-system mapping:
   *
   * - LCM: `IWfiGloss` or `IWfiAnalysis` referenced from `ISegment.AnalysesRS`. `gloss` =
   *   `IWfiGloss.Form` (IMultiUnicode, keyed by analysis writing system). `morphemes` populated
   *   from `IWfiAnalysis.MorphBundlesOS`. `pos` = GUID of `IWfiAnalysis.CategoryRA`. `features`
   *   derived from `MsFeaturesOA` (`IFsFeatStruc`, flattened). `confidence` from
   *   `ICmAgentEvaluation` (reduced across agents). `status` = `approved` when
   *   `ISegment.AnalysesRS` directly references the analysis; `suggested` for parser-generated.
   *   `producer` / `sourceUser` populated from the producing `ICmAgent` (name and, for human
   *   agents, `ICmAgent.HumanRA`).
   * - Paratext: `LexemeCluster` + `WordAnalysis`. `gloss` resolved from the selected
   *   `LexiconSense.Gloss` (per-language strings). `morphemes` from the `Lexeme[]` within
   *   `WordAnalysis` when `LexemeCluster.Type = WordParse`. Paratext stores POS on the lexeme, not
   *   per-analysis. `status` / `confidence` inferred from `InterlinearLexeme.IsGuess` and
   *   `.Score`.
   * - BT Extension: synthesized per-token from `gloss` / `lemmaText` / `senseIds`. BT Extension
   *   stores gloss per-token rather than as shared analysis objects — each token gets its own
   *   `TokenAnalysis`. `status` from `Instance.termStatusNum` (BiblicalTermStatus). `confidence`
   *   inferred from status. No morpheme decomposition — `morphemes` is either empty or a single
   *   whole-word morpheme. `pos` available from Macula TSV for source-language tokens only.
   */
  export type TokenAnalysis = {
    id: string;

    /** Reference to the `Token.id` being analyzed. */
    tokenId: string;

    /** Ordered morpheme breakdown. Omitted for whole-word analyses. */
    morphemes?: Morpheme[];

    /** Part of speech (free-form tag or lexicon POS id). */
    pos?: string;

    /**
     * Morphosyntactic features as a flat attribute-value map (e.g. `{ Case: "Nom", Number: "Sg"
     * }`).
     */
    features?: Record<string, string>;

    /**
     * How much to trust this analysis. Independent of who produced it — see `producer` /
     * `sourceUser` for that.
     */
    confidence?: Confidence;

    /** Required review status. */
    status: AssignmentStatus;

    /**
     * Free-form tag identifying what produced this analysis — e.g. `"human"`, `"parser"`,
     * `"eflomal"`, or a specific tool name. Distinguishes human edits from each of several possible
     * engines.
     */
    producer?: string;

    /**
     * User identifier for human-created or human-edited analyses. Omitted for purely
     * machine-generated entries.
     */
    sourceUser?: string;

    /**
     * Surface text of the token at analysis time — used for drift detection. Consumers compare this
     * against the current `Token.surfaceText`; on mismatch, flip `status` to `Stale` to prompt
     * re-review.
     *
     * Holds the raw surface text for debuggability; can be swapped for a hash if storage cost
     * becomes a concern (token text is typically short, so the literal string is usually fine).
     */
    tokenSnapshot?: string;
  } & (
    | { gloss: MultiString; glossSenseRef?: never }
    | { glossSenseRef: SenseRef; gloss?: never }
    | { gloss?: never; glossSenseRef?: never }
  );

  /**
   * An ordered morpheme within a token's parse.
   *
   * `form` is the morpheme's surface text as it appeared in this analysis context — which may
   * differ from the citation form on the referenced lexicon entry (e.g. under phonological
   * conditioning).
   *
   * All four refs — `entryRef`, `senseRef`, `allomorphRef`, `grammarRef` — point into the Lexicon
   * extension. Surface / citation forms, definitions, POS, inflection class, and other lexical
   * information are read from the extension and not duplicated here.
   *
   * Source-system mapping:
   *
   * - LCM: `IWfiMorphBundle` (1:1). `form` = `IWfiMorphBundle.Form`. `entryRef` = GUID of the
   *   `ILexEntry` that owns `IWfiMorphBundle.MorphRA` (an `IMoForm`, via `LexemeFormOA` or
   *   `AlternateFormsOS`). `senseRef` = GUID of `IWfiMorphBundle.SenseRA`. `allomorphRef` = GUID of
   *   `IWfiMorphBundle.MorphRA` (the specific `IMoForm`). `grammarRef` = GUID of
   *   `IWfiMorphBundle.MsaRA` (`IMoMorphSynAnalysis`).
   * - Paratext: each `Lexeme` within a `WordAnalysis`. `form` = `Lexeme.LexicalForm`. `entryRef` =
   *   `Lexeme.Id` (LexemeKey-derived). `senseRef` = the selected `SenseId` from `LexemeData`.
   *   Paratext's built-in XML lexicon has no separate allomorph or MSA concepts; `allomorphRef` /
   *   `grammarRef` are populated only when an integrated provider (e.g. FLEx via
   *   `IntegratedLexicalProvider`) is active.
   * - BT Extension: not natively modeled as morphemes. A whole-word morpheme can be synthesized:
   *   `form` = `Token.text`, `entryRef` = `headwordId` (BT Extension's HeadWord lemma corresponds
   *   to the FieldWorks LexemeForm / elsewhere allomorph), `senseRef` = `{ senseId: senseIds[0] }`.
   *   Macula TSV `morph` / `stem` fields can supply the specific allomorphic form when it differs
   *   from the lemma. `allomorphRef` / `grammarRef` are left unset — BT Extension does not carry
   *   these.
   */
  export interface Morpheme {
    id: string;

    /** The morpheme form as it appears in this analysis (surface text). */
    form: string;

    /** Writing system of `form`. */
    writingSystem: string;

    /** Lexicon entry this morpheme resolves to. */
    entryRef?: EntryRef;

    /** Specific sense of the entry used here. */
    senseRef?: SenseRef;

    /**
     * Specific allomorph (surface variant) within the entry — an `IMoForm` in the Lexicon
     * extension.
     */
    allomorphRef?: AllomorphRef;

    /**
     * Morphosyntactic analysis (MSA) — grammar / POS information tied to this (entry × sense ×
     * allomorph) usage. Points at an `IMoMorphSynAnalysis` in the Lexicon extension (pending direct
     * exposure — see `GrammarRef`).
     */
    grammarRef?: GrammarRef;
  }

  // ---------------------------------------------------------------------------
  // §6 Phrase — multi-token gloss unit
  // ---------------------------------------------------------------------------

  /**
   * A multi-token unit glossed or analyzed as a single phrase.
   *
   * `tokenIds` lists the tokens (in order) that belong to the phrase. The tokens may be:
   *
   * - Adjacent within one segment ("en el" → "in the")
   * - Disjoint within one segment (French "ne … pas" → "not")
   * - Spanning multiple segments (rare, but permitted)
   *
   * Each token may still carry its own `TokenAnalysis` alongside the phrase; the phrase contributes
   * the combined-unit gloss.
   *
   * `gloss` is a free-form phrase gloss. `senseRef` alternatively points at a lexicon sense when
   * the phrase is a multi-word lexical entry — the Lexicon extension supports both kinds via
   * `IEntry.morphType = Phrase` (contiguous) or `DiscontiguousPhrase` (e.g. "ne … pas"). Setting
   * both is a type error: use one or the other.
   *
   * Provenance fields (`producer`, `sourceUser`, `confidence`, `status`) let a suggestion engine
   * record proposed phrases that a user can then approve or reject, enabling automated recognition
   * of fixed expressions without manual entry.
   *
   * Source-system mapping:
   *
   * - LCM: LCM does not natively model multi-word phrases as first-class objects. Multi-word glosses,
   *   when present, must be synthesized as `Phrase` records during import.
   * - Paratext: a `LexemeCluster` with `Type = Phrase` spans multiple words — each such cluster
   *   becomes one `Phrase` whose `tokenIds` enumerate the covered tokens. `senseRef` is the
   *   selected `LexemeData` reference for the phrase.
   * - BT Extension: not natively tracked. Must be synthesized during migration when adjacent tokens
   *   share the same gloss / sense.
   */
  export type Phrase = {
    id: string;

    /** Ordered `Token.id` values that compose this phrase. */
    tokenIds: string[];

    /** Required review status. */
    status: AssignmentStatus;

    /**
     * How much to trust this phrase. Independent of who produced it — see `producer` / `sourceUser`
     * for that.
     */
    confidence?: Confidence;

    /**
     * Free-form tag identifying what produced this phrase — e.g. `"human"`, `"phrase-detector"`, or
     * a specific tool name.
     */
    producer?: string;

    /**
     * User identifier for human-created or human-edited phrases. Omitted for purely
     * machine-generated entries.
     */
    sourceUser?: string;

    /**
     * Surface text of each token at creation time, parallel to `tokenIds`. Enables drift detection
     * for phrases — if any index's snapshot no longer matches the current `Token.surfaceText`, the
     * phrase is flagged `Stale`.
     *
     * **Invariant:** when present, `tokenSnapshots` must have the same length as `tokenIds` and
     * each index `i` corresponds to the `Token.surfaceText` for `tokenIds[i]`. Consumers must
     * maintain this alignment when filtering or transforming tokens.
     */
    tokenSnapshots?: string[];
  } & (
    | { gloss: MultiString; senseRef?: never }
    | { senseRef: SenseRef; gloss?: never }
    | { gloss?: never; senseRef?: never }
  );

  // ---------------------------------------------------------------------------
  // §7 AlignmentLink, AlignmentEndpoint
  // ---------------------------------------------------------------------------

  /**
   * A directional alignment from one or more source-side endpoints to one or more target-side
   * endpoints. Endpoints resolve to a token or to a specific morpheme within a token's parse.
   *
   * Source-system mapping:
   *
   * - LCM: no native alignment model; links are produced by external tools and attached at import
   *   time.
   * - Paratext: not stored in interlinear data; derivable from parallel interlinear selections when
   *   two projects share versification.
   * - BT Extension: `Alignment` entity. `sourceInstances` / `targetInstances` decompose into
   *   `AlignmentEndpoint`s — one per instance. `status` from `statusNum` via BT Extension's
   *   `AlignmentStatus` enum (CREATED=0, REJECTED=1, APPROVED=2, NEEDS_REVIEW=3) — lossy mapping
   *   where CREATED and NEEDS_REVIEW both become `candidate`. `origin` from `originNum`
   *   (undocumented integer with no enum; descriptive strings defined externally).
   *   Eflomal-generated alignments leave `originNum` and `statusNum` unset (default 0, CREATED).
   */
  export interface AlignmentLink {
    id: string;

    /** Source-side endpoints (one or more tokens / morphemes). */
    sourceEndpoints: AlignmentEndpoint[];

    /** Target-side endpoints (one or more tokens / morphemes). */
    targetEndpoints: AlignmentEndpoint[];

    status: AssignmentStatus;

    /** How the alignment was created (manual, automatic tool, etc.). */
    origin?: string;

    /**
     * Confidence in this alignment link, independent of the confidence on any token analyses at
     * either endpoint.
     */
    confidence?: Confidence;

    /** Multilingual notes keyed by writing system (e.g. UI locale). */
    notes?: MultiString;
  }

  /**
   * One side of an alignment link.
   *
   * When `morphemeId` is set the link connects at the morpheme level (the referenced morpheme lives
   * inside the `TokenAnalysis` whose `tokenId` matches this endpoint). When absent the link
   * connects to the whole token.
   *
   * Resolution chain (morpheme-level): AlignmentEndpoint → Token (via `tokenId`) → TokenAnalysis
   * (same `tokenId` in the analysis layer) → Morpheme (via `morphemeId`) → EntryRef → `IEntry`
   * (Lexicon extension) → SenseRef → `ISense` (Lexicon extension)
   *
   * Resolution chain (token-level): AlignmentEndpoint → Token (surface text only)
   *
   * Source-system mapping:
   *
   * - LCM / Paratext: endpoints produced only through external tools or parallel-project inference
   *   (see `AlignmentLink`).
   * - BT Extension: one endpoint per `Instance` in an `Alignment`'s `sourceInstances` /
   *   `targetInstances`. `morphemeId` is set when the token has a morpheme-level parse; otherwise
   *   the endpoint targets the whole token.
   */
  export interface AlignmentEndpoint {
    /** The `Token.id` this endpoint targets. */
    tokenId: string;

    /** Specific `Morpheme.id` within the token's parse, when applicable. */
    morphemeId?: string;

    /**
     * Surface text of the token at link-creation time — used for drift detection. A link whose
     * endpoint snapshot no longer matches the current `Token.surfaceText` is stale; consumers flip
     * the link's `status` to `Stale` to prompt re-review.
     */
    tokenSnapshot?: string;
  }
}
