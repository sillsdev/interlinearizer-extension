/**
 * @file Extension type declaration file. Platform.Bible shares this with other extensions. Types
 *   exposed here (and in papi-shared-types) are available to other extensions.
 */

/**
 * Interlinearizer Interlinear Model
 *
 * A representation for interlinear data that should cover import from LCM (FieldWorks), Paratext 9,
 * and BT Extension and support the new interlinearizer
 */
declare module 'interlinearizer' {
  // ---------------------------------------------------------------------------
  // Enums
  // ---------------------------------------------------------------------------

  /** Whether an occurrence position holds a word or punctuation. */
  export enum OccurrenceType {
    /** A word occurrence. */
    Word = 'word',
    /** A punctuation occurrence. */
    Punctuation = 'punctuation',
  }

  /** The kind of linguistic analysis represented. */
  export enum AnalysisType {
    /** Surface wordform only — no gloss or morpheme breakdown. */
    Wordform = 'wordform',
    /** Morpheme-level analysis with MorphemeBundles. */
    Morph = 'morph',
    /** Word-level gloss (no morpheme decomposition). */
    Gloss = 'gloss',
    /** Punctuation placeholder. */
    Punctuation = 'punctuation',
  }

  /**
   * How the analysis was produced.
   *
   * - `high`
   * - `medium`
   * - `low`
   * - `guess`
   */
  export enum Confidence {
    Guess = 'guess',
    Low = 'low',
    Medium = 'medium',
    High = 'high',
  }

  /**
   * Lifecycle status of an assignment or alignment link.
   *
   * - `approved` — human-confirmed.
   * - `suggested` — machine-generated or unreviewed.
   * - `candidate` — proposed but not yet reviewed.
   * - `rejected` — explicitly rejected by a human.
   */
  export enum AssignmentStatus {
    Approved = 'approved',
    Suggested = 'suggested',
    Candidate = 'candidate',
    Rejected = 'rejected',
  }

  // ---------------------------------------------------------------------------
  // §1.1 Interlinearization
  // ---------------------------------------------------------------------------

  /**
   * Top-level container for all interlinear data.
   *
   * Source-system mapping:
   *
   * - LCM: one `IScripture` instance (singleton per project).
   * - Paratext: merged from per-book, per-language `InterlinearData` files.
   * - BT Extension: one `Translation` (project scope).
   */
  export interface Interlinearization {
    id: string;

    /** Writing system of the source text being analyzed. */
    sourceWritingSystem: string;

    /**
     * Writing systems in which analyses are provided (e.g. `["en", "fr"]`). A single interlinear
     * can hold analyses in multiple languages.
     */
    analysisLanguages: string[];

    /** Books of scripture (or other texts) that have been analyzed. */
    books: AnalyzedBook[];
  }

  // ---------------------------------------------------------------------------
  // §1.2 AnalyzedBook
  // ---------------------------------------------------------------------------

  /**
   * One book of scripture (or other text unit) analyzed within an Interlinear.
   *
   * Source-system mapping:
   *
   * - LCM: `IScrBook`. `bookRef` = `BookId` (3-letter SIL code).
   * - Paratext: book-level `InterlinearData` (merged across languages).
   * - BT Extension: one book within a `Translation`.
   */
  export interface AnalyzedBook {
    id: string;

    /** Book identifier (e.g. `"GEN"`, `"MAT"`). */
    bookRef: string;

    /**
     * Hash or version stamp of the source text at analysis time. Used to detect when the underlying
     * text has changed and analyses may be stale.
     */
    textVersion: string;

    /** Ordered segments that compose this book. */
    segments: Segment[];
  }

  // ---------------------------------------------------------------------------
  // §1.3 Segment
  // ---------------------------------------------------------------------------

  /**
   * A sentence, clause, or verse — the unit within which occurrences are ordered.
   *
   * Source-system mapping:
   *
   * - LCM: `ISegment` owned by `IScrTxtPara` within `IScrSection`.
   * - Paratext: a verse (`VerseRef`) within `VerseData`.
   * - BT Extension: a `Verse` (BCV identifier).
   */
  export interface Segment {
    id: string;

    /** Canonical reference (e.g. verse reference, paragraph index + offset range). */
    segmentRef: string;

    /** Raw text of the segment, for display and validation. */
    baselineText?: string;

    /** Idiomatic translation of the segment. */
    freeTranslation?: MultiString;

    /** Word-for-word translation. */
    literalTranslation?: MultiString;

    /** Ordered word / punctuation tokens in this segment. */
    occurrences: Occurrence[];
  }

  /** A string value keyed by writing-system tag. */
  export type MultiString = Record<string, string>;

  // ---------------------------------------------------------------------------
  // §1.4 Occurrence
  // ---------------------------------------------------------------------------

  /**
   * A single word or punctuation token at a specific position in the text. Inherits its text
   * version from the parent AnalyzedBook.
   *
   * Source-system mapping:
   *
   * - LCM: entry in `ISegment.AnalysesRS` at a given index.
   * - Paratext: `ClusterData` within `VerseData`.
   * - BT Extension: `Token` (API) / `Instance` (DB).
   */
  export interface Occurrence {
    id: string;

    /** Parent segment. */
    segmentId: string;

    /** Zero-based position within the segment (preserves word order). */
    index: number;

    /**
     * Positional anchor in the source text. Supports BCVWP, BCVWP+partNum, StringRange, or
     * character offset depending on source system.
     */
    anchor: string;

    /** The text as it appears in the source. */
    surfaceText: string;

    /** Writing system of `surfaceText`. */
    writingSystem: string;

    type: OccurrenceType;

    /** All analysis assignments for this occurrence (zero or more). */
    assignments: AnalysisAssignment[];
  }

  // ---------------------------------------------------------------------------
  // §1.5 Analysis
  // ---------------------------------------------------------------------------

  /**
   * A reusable analysis describing a linguistic interpretation of a word. The same analysis can be
   * assigned to many occurrences.
   *
   * Confidence and provenance belong to the analysis itself because they describe how the
   * interpretation was produced.
   *
   * Source-system mapping:
   *
   * - LCM: `IWfiAnalysis` (morph), `IWfiGloss` (gloss), or bare `IWfiWordform` (wordform).
   * - Paratext: `LexemeCluster` + `WordAnalysis`.
   * - BT Extension: synthesized from `Token.gloss` / `lemmaText` / `senseIds`. Requires deduplication
   *   — BT Extension stores gloss/sense per-token, not as shared analysis objects.
   */
  export interface Analysis {
    id: string;

    /** Writing system of the analysis (e.g. the gloss language). */
    analysisLanguage: string;

    analysisType: AnalysisType;

    confidence: Confidence;

    /** System that produced the analysis (e.g. "lcm", "paratext"). */
    sourceSystem: string;

    /**
     * User or automation identifier within the source system (e.g. "jsmith", "parser-v3",
     * "auto-glosser"). Use a stable automation ID when no human directly applied the analysis.
     */
    sourceUser: string;

    /** Word-level gloss text. */
    glossText?: string;

    /** Part of speech. */
    pos?: string;

    /** Morphosyntactic feature structure. */
    features?: Record<string, unknown>;

    /** Ordered morpheme breakdown, when analysis is at the morpheme level (`analysisType = morph`). */
    morphemeBundles?: MorphemeBundle[];
  }

  // ---------------------------------------------------------------------------
  // §1.6 AnalysisAssignment
  // ---------------------------------------------------------------------------

  /**
   * The join between an occurrence and an analysis. Multiple assignments per occurrence enable
   * competing analyses.
   *
   * Source-system mapping:
   *
   * - LCM: `ISegment.AnalysesRS[i]` referencing `IWfiGloss` or `IWfiAnalysis`.
   * - Paratext: `ClusterData` with selected `LexemeData`.
   * - BT Extension: `Token` linked to senses (`senseIds`). Status inferred from
   *   `Instance.termStatusNum` (BiblicalTermStatus enum).
   */
  export interface AnalysisAssignment {
    id: string;

    /** The occurrence being analyzed. */
    occurrenceId: string;

    /** The analysis applied. */
    analysisId: string;

    /** Whether a human has confirmed this analysis for this occurrence. */
    status: AssignmentStatus;

    /** Timestamp of when the assignment was made. */
    createdAt?: string;
  }

  // ---------------------------------------------------------------------------
  // §1.7 MorphemeBundle
  // ---------------------------------------------------------------------------

  /**
   * An ordered morpheme within a morpheme-level analysis, linking to the lexicon.
   *
   * The four optional lexicon references mirror LCM's `IWfiMorphBundle` three-way link plus the
   * owning entry:
   *
   * `allomorphRef` → `IMoForm` (which surface form / allomorph) `lexemeRef` → `ILexEntry` (owning
   * dictionary entry) `senseRef` → `ILexSense` (which meaning) `grammarRef` → `IMoMorphSynAnalysis`
   * (grammatical behaviour)
   *
   * In LCM an `ILexEntry` owns one _LexemeForm_ (the elsewhere / citation allomorph) and
   * zero-or-more _AlternateForms_ — both are `IMoForm`. `allomorphRef` identifies the specific
   * `IMoForm` matched in this context; `lexemeRef` identifies the entry that owns it.
   *
   * `form` vs `allomorphRef` — `form` is the surface text of the morpheme as it appeared in this
   * specific analysis context. `allomorphRef` is a reference (ID) to the canonical allomorph object
   * in the lexicon. These can legitimately differ: in LCM `IWfiMorphBundle.Form` may reflect
   * phonological conditioning that differs from the canonical `IMoForm.Form`. When `allomorphRef`
   * is absent, `form` is the only record of the morpheme shape.
   *
   * Source-system mapping:
   *
   * - LCM: `IWfiMorphBundle` (1:1). `allomorphRef` = GUID of `IWfiMorphBundle.MorphRA` (`IMoForm`).
   *   `lexemeRef` = GUID of the `ILexEntry` that owns that `IMoForm` (via `LexemeFormOA` or
   *   `AlternateFormsOS`).
   * - Paratext: each `Lexeme` within a `WordAnalysis`. Paratext's built-in XML lexicon has no
   *   allomorph concept distinct from the entry — `Lexeme.AlternateForms` exists in the interface
   *   but returns empty. `allomorphRef` is therefore omitted for the built-in lexicon. When an
   *   integrated provider (e.g. FLEx via `IntegratedLexicalProvider`) is active, `AllomorphEntry`
   *   surfaces actual allomorphs and `allomorphRef` can be populated. `lexemeRef` = `Lexeme.Id`
   *   (LexemeKey-derived).
   * - BT Extension: not natively modeled as morpheme bundles. A whole-word bundle can be synthesized:
   *   `form` = `Token.text`, `allomorphRef` = `headwordId` (the BT Extension "morph" concept
   *   corresponds to the FieldWorks Allomorph; the HeadWord's lemma is the elsewhere / LexemeForm
   *   allomorph), `lexemeRef` = `headwordId`, `senseRef` = `senseIds[0]`. Macula TSV `morph` field
   *   can supply the specific allomorphic form when it differs from the lemma.
   */
  export interface MorphemeBundle {
    id: string;

    /** Zero-based position within the analysis (preserves morpheme order). */
    index: number;

    /** The morpheme form as it appears in this analysis (surface text). */
    form: string;

    /** Writing system of `form`. */
    writingSystem: string;

    /**
     * Reference to a specific Allomorph (`IMoForm`) in the lexical model.
     *
     * An `ILexEntry` in LCM owns one _LexemeForm_ (the elsewhere / citation allomorph) and
     * zero-or-more _AlternateForms_. This field identifies which allomorph was matched in this
     * morpheme position.
     *
     * In the BT Extension the "morph" concept aligns with this field: the HeadWord's lemma acts as
     * the LexemeForm (elsewhere allomorph).
     */
    allomorphRef?: string;

    /** Reference to Lexeme (`ILexEntry`) in the lexical model. */
    lexemeRef?: string;

    /** Reference to Sense (`ILexSense`) in the lexical model. */
    senseRef?: string;

    /** Reference to Grammar / MSA (`IMoMorphSynAnalysis`) in the lexical model. */
    grammarRef?: string;
  }

  // ---------------------------------------------------------------------------
  // §1.8 InterlinearAlignment
  // ---------------------------------------------------------------------------

  /**
   * A project pairing a source-language interlinearization and a target-language interlinear with
   * morph-level alignment links between them.
   *
   * Both interlinearizations carry their own analyzed books, segments, occurrences, and analyses.
   * AlignmentLinks bridge the two, connecting individual morphemes (MorphemeBundles) or whole
   * unanalyzed words (Occurrences) across the language boundary.
   *
   * Source-system mapping:
   *
   * - LCM: LCM has no native alignment or bilingual pairing model. An InterlinearAlignment is
   *   constructed by pairing a Scripture- based interlinearization (vernacular) with a source-text
   *   interlinearization produced externally (e.g. Greek/Hebrew resource text).
   * - Paratext: not directly represented. Can be constructed from parallel projects that share the
   *   same versification.
   * - BT Extension: one `Translation` scoped to source + target sides (`Translation.sideNum`: 1 =
   *   source, 2 = target). Each side becomes an `Interlinearization`. `Alignment` records become
   *   `AlignmentLink`s.
   */
  export interface InterlinearAlignment {
    id: string;

    /** The source-language interlinearization (e.g. Greek / Hebrew). */
    source: Interlinearization;

    /** The target-language interlinearization (e.g. vernacular translation). */
    target: Interlinearization;

    /**
     * Morph-level alignment links connecting endpoints in the source interlinear to endpoints in
     * the target interlinear.
     */
    links: AlignmentLink[];
  }

  // ---------------------------------------------------------------------------
  // §1.9 AlignmentLink
  // ---------------------------------------------------------------------------

  /**
   * A directional alignment link from one or more source-text morphemes / words to one or more
   * target-text morphemes / words.
   *
   * Each endpoint resolves to either:
   *
   * - A specific MorphemeBundle within a fully analyzed occurrence, connecting at the allomorph level
   *   (via `allomorphRef`).
   * - A whole unanalyzed occurrence, when no morpheme-level analysis exists.
   *
   * Typical workflow: the user selects a morph from the source-text interlinear and connects it to
   * an allomorph of a fully analyzed occurrence in the target-text interlinear — or to an
   * unanalyzed occurrence if the target word has not yet been broken into morphemes.
   *
   * Source-system mapping:
   *
   * - LCM: no native alignment model; links are produced by external tools.
   * - Paratext: not stored in interlinear data; derivable from parallel interlinear selections when
   *   two projects share versification.
   * - BT Extension: `Alignment` entity. Each `Alignment` record with `sourceInstances` /
   *   `targetInstances` is decomposed into `AlignmentEndpoint`s — one per instance. BT Extension's
   *   "morph" concept (the token's morphological form) maps to a MorphemeBundle-level endpoint when
   *   a morpheme analysis is present; otherwise the endpoint targets the whole occurrence. `status`
   *   from `statusNum` via BT Extension's `AlignmentStatus` enum (CREATED=0, REJECTED=1,
   *   APPROVED=2, NEEDS_REVIEW=3) — lossy mapping where both CREATED and NEEDS_REVIEW collapse to
   *   `candidate`. `origin` from `originNum` — an undocumented integer with no enum; descriptive
   *   strings must be defined externally. Eflomal-generated alignments leave `originNum` and
   *   `statusNum` unset, so both default to 0 (`CREATED`).
   */
  export interface AlignmentLink {
    id: string;

    /** Source-side endpoints (one or more morphemes / words from the source interlinear). */
    sourceEndpoints: AlignmentEndpoint[];

    /** Target-side endpoints (one or more morphemes / words from the target interlinear). */
    targetEndpoints: AlignmentEndpoint[];

    status: AssignmentStatus;

    /** How the alignment was created (manual, automatic tool, etc.). */
    origin?: string;

    /**
     * Confidence in this alignment link, independent of the confidence on the analyses at each
     * endpoint.
     */
    confidence?: Confidence;

    /** Multilingual notes keyed by writing system (e.g. UI locale). */
    notes?: MultiString;
  }

  // ---------------------------------------------------------------------------
  // §1.10 AlignmentEndpoint
  // ---------------------------------------------------------------------------

  /**
   * One side of an alignment link, identifying a precise point of connection within an interlinear
   * text.
   *
   * When the referenced occurrence has a morpheme-level analysis, `bundleId` identifies the
   * specific MorphemeBundle — and by extension its `allomorphRef` (IMoForm), `lexemeRef`
   * (ILexEntry), `senseRef` (ILexSense), and `grammarRef` (IMoMorphSynAnalysis).
   *
   * When the occurrence is unanalyzed, `bundleId` is absent and the link targets the whole word.
   *
   * Resolution chain (fully analyzed): AlignmentEndpoint → Occurrence → AnalysisAssignment →
   * Analysis → MorphemeBundle → allomorphRef (IMoForm) → lexemeRef (ILexEntry) → senseRef
   * (ILexSense) → grammarRef (IMoMorphSynAnalysis)
   *
   * Resolution chain (unanalyzed): AlignmentEndpoint → Occurrence → surfaceText only
   */
  export interface AlignmentEndpoint {
    /** The word or punctuation occurrence in the text. */
    occurrenceId: string;

    /**
     * Identifies a specific MorphemeBundle within one of the occurrence's analyses. When set, the
     * alignment connects at the allomorph / morpheme level. When absent, the alignment connects to
     * the whole (unanalyzed) occurrence.
     */
    bundleId?: string;
  }
}
