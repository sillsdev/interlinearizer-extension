/**
 * @file Extension type declaration file. Platform.Bible shares this with other extensions. Types
 *   exposed here (and in papi-shared-types) are available to other extensions.
 */

declare module 'papi-shared-types' {
  export interface ProjectSettingTypes {
    /**
     * When true, the Interlinearizer displays a continuous horizontal token scroll strip above the
     * chapter segments. When false, only chapter segments are shown in token-chip mode.
     */
    'interlinearizer.continuousScroll': boolean;
  }

  export interface CommandHandlers {
    /**
     * Opens the Interlinearizer for the project associated with the given WebView ID. Called from
     * WebView context menus, which pass the tab's WebView ID as the argument. Falls back to a
     * project picker dialog if the WebView has no project or no ID is given.
     */
    'interlinearizer.openForWebView': (webViewId?: string) => Promise<string | undefined>;

    /**
     * Creates a new interlinearizer project for the given source project. Called from the WebView
     * after the user fills in the create-project modal. Returns the persisted project serialized as
     * a JSON string, or undefined if project creation fails (failure is logged and surfaced as an
     * error notification).
     *
     * @param sourceProjectId Platform.Bible project ID of the source text to interlinearize.
     * @param analysisLanguages BCP 47 tags for all languages used in glosses and annotations (e.g.
     *   `['en']`). LCM: one per writing system present on `IWfiGloss.Form`. Paratext: one per
     *   merged `GlossLanguage` file. BT Extension: typically one language.
     * @param targetProjectId Optional Platform.Bible project ID of the target text. Required for BT
     *   Extension projects so that `AlignmentLink.targetEndpoints` can be resolved at runtime.
     *   Omitted for analysis-only projects (LCM, PT9 single-sided).
     * @param name Optional user-facing name for the project.
     * @param description Optional user-facing description for the project.
     */
    'interlinearizer.createProject': (
      sourceProjectId: string,
      analysisLanguages: string[],
      targetProjectId?: string,
      name?: string,
      description?: string,
    ) => Promise<string | undefined>;

    /**
     * Returns all interlinearizer projects for the given source project, serialized as a JSON
     * string. Returns `"[]"` when none exist. The WebView uses this to populate the project picker
     * and to decide whether to show "create new" vs "select existing" on first open.
     *
     * @param sourceProjectId Platform.Bible project ID of the source text to query.
     */
    'interlinearizer.getProjectsForSource': (sourceProjectId: string) => Promise<string>;

    /**
     * Deletes an interlinearizer project by UUID.
     *
     * @param interlinearProjectId UUID of the interlinearizer project to delete.
     * @throws {RangeError} If the project ID is not found in the stored index.
     */
    'interlinearizer.deleteProject': (interlinearProjectId: string) => Promise<void>;

    /**
     * Opens the project-selector modal in the Interlinearizer WebView. The backend registers this
     * command to make it visible to the platform menu system; all logic executes in the WebView.
     */
    'interlinearizer.openSelectProjectModal': () => Promise<void>;

    /**
     * Opens the create-project modal in the Interlinearizer WebView. The backend registers this
     * command to make it visible to the platform menu system; all logic executes in the WebView.
     */
    'interlinearizer.openNewProjectModal': () => Promise<void>;

    /**
     * Opens the project-info modal for the active project in the Interlinearizer WebView. The
     * backend registers this command to make it visible to the platform menu system; all logic
     * executes in the WebView.
     */
    'interlinearizer.openProjectInfoModal': () => Promise<void>;

    /**
     * Updates the metadata of an existing interlinearizer project. Returns the updated project as a
     * JSON string, or `undefined` if no project with the given ID exists.
     *
     * @param interlinearProjectId UUID of the interlinearizer project to update.
     * @param name New user-facing name; omit or pass `undefined` to clear.
     * @param description New user-facing description; omit or pass `undefined` to clear.
     * @param analysisLanguages New BCP 47 analysis language tags. Must be a non-empty array; pass
     *   the current value to leave it unchanged (the field is required and cannot be cleared).
     * @param targetProjectId New target-project ID; omit or pass `undefined` to clear (removes the
     *   target-side text binding).
     */
    'interlinearizer.updateProjectMetadata': (
      interlinearProjectId: string,
      name: string | undefined,
      description: string | undefined,
      analysisLanguages: string[],
      targetProjectId?: string,
    ) => Promise<string | undefined>;
  }
}

/**
 * Interlinearizer Interlinear Model
 *
 * A representation for interlinear data that should cover import from LCM (FieldWorks), Paratext 9,
 * and BT Extension and support the new interlinearizer.
 *
 * Shape at a glance:
 *
 *     ActiveProject
 *     ├─ project : InterlinearProject   — persisted envelope (analysis + links)
 *     ├─ source  : Book[]               — source text layer (rebuilt from USJ at runtime)
 *     └─ target? : Book[]               — target text layer (rebuilt from USJ at runtime; absent for analysis-only projects)
 *          └─ Segment[] → Token[]
 *
 *     InterlinearProject.analysis : TextAnalysis   — analysis layer (flat)
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
 * Punctuation tokens are first-class citizens of the text layer — they are stored in
 * `Segment.tokens` so the baseline text can be reconstructed faithfully. They are simply omitted
 * from the analysis layer's `tokenAnalyses` (rather than stored there with empty analyses).
 *
 * Staleness detection: analysis records and alignment endpoints carry a `tokenSnapshot` of the
 * token's surface text at analysis time. When the baseline changes, consumers compare the snapshot
 * against the current `Token.surfaceText` and flip `status` to `'stale'` on mismatch to prompt
 * re-review.
 */
declare module 'interlinearizer' {
  // ---------------------------------------------------------------------------
  // Enums
  // ---------------------------------------------------------------------------

  /** Whether a token holds a word or punctuation. */
  export type TokenType = 'word' | 'punctuation';

  /**
   * Confidence level of an analysis.
   *
   * - `high` — human-created or human-confirmed
   * - `medium` — tool-assisted, reasonably confident
   * - `low` — tool-assisted, low certainty
   * - `guess` — unreviewed machine suggestion
   */
  export type Confidence = 'high' | 'medium' | 'low' | 'guess';

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
  export type AssignmentStatus = 'approved' | 'suggested' | 'candidate' | 'rejected' | 'stale';

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
    /** 3-letter SIL book code (e.g. `"GEN"`). */
    book: string;
    /** 1-based chapter number. */
    chapter: number;
    /** 1-based verse number. */
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
  // §1 Text layer — Book, Segment, Token
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
    /** Unique identifier for this book; typically equal to `bookRef`. */
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
    /**
     * Unique within the owning `Book` — used as the cross-reference key by
     * `SegmentAnalysis.segmentId`.
     */
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
   * the owning `Segment.baselineText` (`charEnd` is exclusive — one past the last code unit). These
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
    /**
     * Unique within the owning `Book` — used as the cross-reference key by `TokenAnalysis.tokenId`,
     * `Phrase.tokenIds`, and `AlignmentEndpoint.tokenId`.
     */
    id: string;

    /** The token's text as it appears in the baseline. */
    surfaceText: string;

    /** Writing system of `surfaceText`. */
    writingSystem: string;

    /** Whether this token is a word or punctuation. */
    type: TokenType;

    /**
     * Zero-based character start offset of this token within the owning `Segment.baselineText`.
     * Together with `charEnd`, uniquely locates the token in the baseline regardless of script
     * type.
     */
    charStart: number;

    /**
     * Exclusive character end offset of this token within the owning `Segment.baselineText` — one
     * past the last code unit. `baselineText.slice(charStart, charEnd)` must equal `surfaceText`.
     */
    charEnd: number;
  }

  // ---------------------------------------------------------------------------
  // §2 Analysis layer — TextAnalysis, SegmentAnalysis
  // ---------------------------------------------------------------------------

  /**
   * The analysis layer for an `InterlinearProject`.
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
     * **Invariant:** at most one `SegmentAnalysis` per `segmentId` has `status: 'approved'`. That
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
     * **Invariant:** at most one `TokenAnalysis` per `tokenId` has `status: 'approved'`. That entry
     * is the canonical analysis for rendering; alternates are available to review workflows via the
     * other statuses (`'suggested'`, `'candidate'`, `'rejected'`, `'stale'`).
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
    /**
     * Unique within the owning `TextAnalysis` — used as a stable reference for this analysis
     * record.
     */
    id: string;

    /**
     * Reference to the corresponding `Segment.id` in the text layer (unique within the owning
     * `Book`).
     */
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
  // §3 TokenAnalysis — parse + 1:1 gloss
  // ---------------------------------------------------------------------------

  /**
   * Analysis of a single token: a word-level (1:1) gloss plus optional morpheme-level parse.
   *
   * `gloss` is a free-form gloss string for the token (keyed by analysis-language tag).
   * `glossSenseRef` resolves the gloss through a specific `ISense` in the Lexicon extension — when
   * set, the sense's gloss text can be surfaced and refreshed automatically if the lexicon is
   * edited. Both may be present simultaneously; when they are, `gloss` takes precedence for
   * rendering (the local override wins over the lexicon-derived value).
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
    /**
     * Unique within the owning `TextAnalysis` — used as the cross-reference key by
     * `AlignmentEndpoint.tokenAnalysisId` for morpheme-level alignment links.
     */
    id: string;

    /** Reference to the `Token.id` being analyzed (unique within the owning `Book`). */
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
     * against the current `Token.surfaceText`; on mismatch, flip `status` to `'stale'` to prompt
     * re-review.
     *
     * Holds the raw surface text for debuggability; can be swapped for a hash if storage cost
     * becomes a concern (token text is typically short, so the literal string is usually fine).
     */
    tokenSnapshot?: string;

    /**
     * Free-form gloss string keyed by BCP 47 analysis-language tag. Takes precedence over
     * `glossSenseRef` when both are present.
     */
    gloss?: MultiString;

    /**
     * Reference to the `ISense` in the Lexicon extension whose gloss text this analysis uses. May
     * coexist with `gloss`; when both are present, `gloss` is the active rendering value and
     * `glossSenseRef` is retained so the lexicon link is not lost.
     */
    glossSenseRef?: SenseRef;
  };

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
    /**
     * Unique within the owning `TokenAnalysis.morphemes` array — used as the cross-reference key by
     * `AlignmentEndpoint.morphemeId`.
     */
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
  // §4 Phrase — multi-token gloss unit
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
   * `gloss` is a free-form phrase gloss. `senseRef` points at a lexicon sense when the phrase is a
   * multi-word lexical entry — the Lexicon extension supports both kinds via `IEntry.morphType =
   * Phrase` (contiguous) or `DiscontiguousPhrase` (e.g. "ne … pas"). Both may be present
   * simultaneously; when they are, `gloss` takes precedence for rendering.
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
    /** Unique within the owning `TextAnalysis` — used as a stable reference for this phrase record. */
    id: string;

    /** Ordered `Token.id` values that compose this phrase. */
    tokenIds: [string, ...string[]];

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
    tokenSnapshots?: [string, ...string[]];

    /**
     * Free-form gloss string keyed by BCP 47 analysis-language tag. Takes precedence over
     * `senseRef` when both are present.
     */
    gloss?: MultiString;

    /**
     * Reference to the `ISense` in the Lexicon extension this phrase maps to. May coexist with
     * `gloss`; when both are present, `gloss` is the active rendering value and `senseRef` is
     * retained so the lexicon link is not lost.
     */
    senseRef?: SenseRef;
  };

  // ---------------------------------------------------------------------------
  // §5 AlignmentLink, AlignmentEndpoint
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
    /** Unique within the owning `InterlinearProject` — stable reference for this link. */
    id: string;

    /** Source-side endpoints (one or more tokens / morphemes). */
    sourceEndpoints: AlignmentEndpoint[];

    /** Target-side endpoints (one or more tokens / morphemes). */
    targetEndpoints: AlignmentEndpoint[];

    /** Review status of this alignment link. */
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
   * When `morphemeId` is set the link connects at the morpheme level. Because a single token may
   * have multiple competing `TokenAnalysis` entries, `tokenAnalysisId` is **required** alongside
   * `morphemeId` to identify the specific `TokenAnalysis` that owns the referenced morpheme. When
   * `morphemeId` is absent the link connects to the whole token.
   *
   * Resolution chain (morpheme-level): AlignmentEndpoint → Token (via `tokenId`) → TokenAnalysis
   * (via `tokenAnalysisId`) → Morpheme (via `morphemeId`) → EntryRef → `IEntry` (Lexicon extension)
   * → SenseRef → `ISense` (Lexicon extension)
   *
   * Resolution chain (token-level): AlignmentEndpoint → Token (surface text only)
   *
   * Source-system mapping:
   *
   * - LCM / Paratext: endpoints produced only through external tools or parallel-project inference
   *   (see `AlignmentLink`).
   * - BT Extension: one endpoint per `Instance` in an `Alignment`'s `sourceInstances` /
   *   `targetInstances`. `morphemeId` and `tokenAnalysisId` are set when the token has a
   *   morpheme-level parse; otherwise the endpoint targets the whole token.
   */
  export type AlignmentEndpoint = {
    /** The `Token.id` this endpoint targets. */
    tokenId: string;

    /**
     * Surface text of the token at link-creation time — used for drift detection. A link whose
     * endpoint snapshot no longer matches the current `Token.surfaceText` is stale; consumers flip
     * the link's `status` to `'stale'` to prompt re-review.
     */
    tokenSnapshot?: string;
  } &
    /**
     * Either both `morphemeId` and `tokenAnalysisId` are set (morpheme-level link), or neither is
     * set (token-level link). `tokenAnalysisId` is required alongside `morphemeId` because a single
     * token may have multiple competing `TokenAnalysis` entries; without it the target morpheme
     * would be ambiguous.
     */
    (| { morphemeId?: never; tokenAnalysisId?: never }
      | {
          /**
           * The `TokenAnalysis.id` that owns the referenced morpheme. Required when `morphemeId` is
           * set.
           */
          tokenAnalysisId: string;
          /** Specific `Morpheme.id` within the identified `TokenAnalysis.morphemes`. */
          morphemeId: string;
        }
    );

  // ---------------------------------------------------------------------------
  // §6 InterlinearProject — persisted project envelope
  // ---------------------------------------------------------------------------

  /**
   * The storage envelope for one interlinearizer project. Multiple projects may exist for the same
   * source project (e.g. different analysis languages, or different target alignments).
   *
   * The token hierarchy (`Book` / `Segment` / `Token`) is **not** stored here — it is rebuilt from
   * Platform.Bible's USJ on each load. Only the analysis data and alignment links are persisted.
   * Token-level drift is detected via `tokenSnapshot` fields on `TokenAnalysis` and
   * `AlignmentEndpoint` records.
   *
   * Projects are stored via `papi.storage` (extension-host only) under two keys:
   *
   * - `'projectIds'` — ordered `string[]` of all project UUIDs.
   * - `'project:{id}'` — JSON-serialized `InterlinearProject` for each project.
   */
  export interface InterlinearProject {
    /** UUID v4 generated at creation time. */
    id: string;

    /** ISO 8601 creation timestamp. */
    createdAt: string;

    /** Optional user-facing name for the project. */
    name?: string;

    /** Optional user-facing description of the project's purpose. */
    description?: string;

    /** Platform.Bible project ID for the source text (the side being analyzed). */
    sourceProjectId: string;

    /**
     * Platform.Bible project ID for the target text. Present only for bilateral alignment projects
     * (e.g. BT Extension imports) where `AlignmentLink.targetEndpoints` must resolve to tokens in a
     * second text. Omitted for analysis-only projects (LCM, PT9 single-sided glossing).
     *
     * When present, the `ActiveProject.target` books are rebuilt from this project's USJ on load,
     * exactly as `ActiveProject.source` is rebuilt from `sourceProjectId`.
     *
     * BT Extension: corresponds to one `Translation` scoped to two sides (`Translation.sideNum`).
     * By BT convention `sideNum = 1` is the source and `sideNum = 2` is the target;
     * `sourceProjectId` maps to the side-1 project and `targetProjectId` maps to the side-2
     * project.
     */
    targetProjectId?: string;

    /**
     * BCP 47 tags for all languages used in glosses and annotations (e.g. `['und']`). Populates
     * `MultiString` keys in `TokenAnalysis`, `SegmentAnalysis`, and `Phrase` records.
     *
     * Source-system mapping:
     *
     * - LCM: the set of writing systems present on `IWfiGloss.Form` (one tag per analysis language in
     *   the project).
     * - Paratext: one tag per merged `GlossLanguage` file
     *   (`Interlinear_{language}/Interlinear_{language}_{book}.xml`).
     * - BT Extension: typically a single language; set from the per-token `gloss` writing system.
     */
    analysisLanguages: string[];

    /** Analysis layer. Empty at creation; populated as the user annotates tokens. */
    analysis: TextAnalysis;

    /**
     * Token- or morpheme-level alignment links. Empty at creation; populated as the user aligns
     * source and target tokens.
     */
    links: AlignmentLink[];
  }

  // ---------------------------------------------------------------------------
  // §7 ActiveProject — runtime pairing of project envelope and text layers
  // ---------------------------------------------------------------------------

  /**
   * The runtime object for an open interlinearizer project. Pairs the persisted
   * {@link InterlinearProject} envelope with the reconstructed text hierarchies.
   *
   * `source` and `target` are rebuilt from Platform.Bible's USJ on each load and are never
   * serialized. All annotation and alignment mutations target `project.analysis` and
   * `project.links`; saving is done by writing those fields back to storage via
   * `saveProjectAnalysis`.
   *
   * `target` is present only when `project.targetProjectId` is set (bilateral alignment projects
   * such as BT Extension imports). When present, `AlignmentLink.targetEndpoints` token IDs resolve
   * against these books; when absent, only `sourceEndpoints` can be resolved.
   *
   * BT Extension: `source` corresponds to `Translation.sideNum = 1` and `target` to `sideNum = 2`,
   * following BT's convention that side 1 is the input being analyzed and side 2 is the output.
   */
  export interface ActiveProject {
    /** The persisted project envelope. Mutations target `project.analysis` and `project.links`. */
    project: InterlinearProject;

    /**
     * The reconstructed source books, built from Platform.Bible USJ on load. Never serialized —
     * rebuilt on every activation. Typically one book per scripture book code; multiple books may
     * be present when the UI has prefetched adjacent books.
     */
    source: Book[];

    /**
     * The reconstructed target books, built from `project.targetProjectId`'s USJ on load. Present
     * only when `project.targetProjectId` is set; absent for analysis-only projects (LCM, PT9).
     * Never serialized — rebuilt on every activation alongside `source`.
     */
    target?: Book[];
  }
}
