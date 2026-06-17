/**
 * @file Extension type declaration file. Platform.Bible shares this with other extensions. Types
 *   exposed here (and in papi-shared-types) are available to other extensions.
 */

declare module 'papi-shared-types' {
  /** Project-level settings contributed by the Interlinearizer extension. */
  export interface ProjectSettingTypes {
    /**
     * When true, the Interlinearizer displays a continuous horizontal token scroll strip above the
     * chapter segments. When false, only chapter segments are shown in token-chip mode.
     */
    'interlinearizer.continuousScroll': boolean;
    /**
     * When true, link/unlink buttons between tokens are hidden in segments that are not the
     * currently active verse.
     */
    'interlinearizer.hideInactiveLinkButtons': boolean;
    /**
     * When true, phrases are rendered in a reduced state keyed to phrase focus rather than verse
     * activity: every phrase except the focused one shows only its box and arc, with interactive
     * controls (split buttons, intra-phrase unlink icons) and hover effects suppressed.
     */
    'interlinearizer.simplifyPhrases': boolean;
    /**
     * Controls how chapter boundaries are marked in the segment list. When false (the default), a
     * chapter shows an inline header above the first verse of each new chapter and the verse label
     * stays a bare verse number. When true, the inline header is omitted and the first verse of
     * each chapter is labeled `chapter:verse` instead of a bare verse number.
     */
    'interlinearizer.chapterLabelInVerse': boolean;
    /**
     * When true, each word token displays its morpheme breakdown and per-morpheme glosses beneath
     * the token-level gloss input.
     */
    'interlinearizer.showMorphology': boolean;
  }

  /**
   * Command handler signatures contributed by the Interlinearizer extension to the PAPI command
   * bus.
   */
  export interface CommandHandlers {
    /**
     * Opens the Interlinearizer for the project associated with the given WebView ID. Called from
     * WebView context menus, which pass the tab's WebView ID as the argument. Falls back to a
     * project picker dialog if the WebView has no project or no ID is given.
     *
     * @param webViewId - ID of the WebView tab whose associated project should be opened; when
     *   omitted or when the WebView has no linked project, a project-picker dialog is shown
     *   instead.
     * @returns A promise that resolves to the opened WebView ID, or `undefined` if the user
     *   dismissed the picker without selecting a project.
     */
    'interlinearizer.openForWebView': (webViewId?: string) => Promise<string | undefined>;

    /**
     * Creates a new interlinearizer project for the given source project. Called from the WebView
     * after the user fills in the create-project modal. Returns the persisted `InterlinearProject`
     * serialized as a JSON string.
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
     * @returns The persisted `InterlinearProject` as a JSON string.
     * @throws If storage fails. The error is logged and an error notification is sent before
     *   rethrowing so callers do not need to send a second notification.
     */
    'interlinearizer.createProject': (
      sourceProjectId: string,
      analysisLanguages: string[],
      targetProjectId?: string,
      name?: string,
      description?: string,
    ) => Promise<string>;

    /**
     * Returns all interlinearizer projects for the given source project, serialized as a JSON
     * string. Returns `"[]"` when none exist. The WebView uses this to populate the project picker
     * and to decide whether to show "create new" vs "select existing" on first open.
     *
     * @param sourceProjectId Platform.Bible project ID of the source text to query.
     * @returns A JSON string containing an `InterlinearProject[]`; `"[]"` when none exist.
     * @throws {SyntaxError} If the project-IDs index or any stored project record contains invalid
     *   JSON.
     * @throws If `papi.storage.readUserData` rejects for a reason other than the file not existing
     *   (propagated from the storage layer). Callers can use this to distinguish a storage outage
     *   from a legitimately empty list.
     */
    'interlinearizer.getProjectsForSource': (sourceProjectId: string) => Promise<string>;

    /**
     * Deletes an interlinearizer project by UUID. No-ops silently if the project does not exist.
     *
     * @param interlinearProjectId UUID of the interlinearizer project to delete.
     * @throws If the underlying storage write fails (the failure is also logged and surfaced as an
     *   error notification before being re-thrown).
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
     * Opens the project-info (metadata) modal for the active project in the Interlinearizer
     * WebView. The backend registers this command to make it visible to the platform menu system;
     * all logic executes in the WebView.
     */
    'interlinearizer.openProjectInfoModal': () => Promise<void>;

    /**
     * Returns the interlinearizer project with the given UUID as a JSON string, including its full
     * `TextAnalysis`. The WebView calls this when the active project changes to load the stored
     * analysis.
     *
     * @param interlinearProjectId UUID of the interlinearizer project to fetch.
     * @returns JSON-stringified `InterlinearProject`, or `undefined` if not found.
     * @throws If storage fails (logged before rethrowing).
     */
    'interlinearizer.getProject': (interlinearProjectId: string) => Promise<string | undefined>;

    /**
     * Persists an updated `TextAnalysis` for an interlinearizer project. Called from the WebView
     * after each gloss write so that analysis changes survive tab restores and project switches.
     *
     * @param interlinearProjectId UUID of the interlinearizer project to update.
     * @param analysisJson JSON-stringified `TextAnalysis` to persist.
     * @returns Promise that resolves to void once the analysis has been written to storage.
     * @throws If JSON parsing or storage fails. Error is logged and an error notification is sent
     *   before rethrowing so callers do not need to send a second notification.
     */
    'interlinearizer.saveAnalysis': (
      interlinearProjectId: string,
      analysisJson: string,
    ) => Promise<void>;

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
     * @returns The updated project as a JSON string, or `undefined` if no project with that ID
     *   exists.
     * @throws If storage fails. The error is logged and an error notification is sent before
     *   rethrowing so callers do not need to send a second notification.
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
 *       ├─ project : InterlinearProject
 *       ├─ source  : Book[]
 *       └─ target? : Book[]   — present only when targetProjectId is set
 *
 *     InterlinearProject
 *       ├─ sourceProjectId
 *       ├─ targetProjectId?  — absent for analysis-only projects (LCM, PT9)
 *       ├─ analysisLanguages : string[]
 *       ├─ analysis : TextAnalysis
 *       └─ links?   : AlignmentLink[]
 *
 *     TextAnalysis
 *       ├─ segmentAnalyses      : SegmentAnalysis[]
 *       ├─ segmentAnalysisLinks : SegmentAnalysisLink[]
 *       ├─ tokenAnalyses        : TokenAnalysis[]
 *       ├─ tokenAnalysisLinks   : TokenAnalysisLink[]
 *       ├─ phraseAnalyses       : PhraseAnalysis[]
 *       └─ phraseAnalysisLinks  : PhraseAnalysisLink[]
 *
 * The analysis layer is **flat** — not a mirror of the text layer's book / segment nesting.
 * Analysis payloads (`SegmentAnalysis`, `TokenAnalysis`, `PhraseAnalysis`) are stored separately
 * from their text-layer attachments. Link records (`segmentAnalysisLinks`, `tokenAnalysisLinks`,
 * `phraseAnalysisLinks`) connect each analysis id to one segment or one/many tokens. Consumers
 * index links by segment/token ids at load time to render a segment at a time.
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
 * Staleness detection: `AlignmentEndpoint` records carry a token snapshot via `token.surfaceText`.
 * When the baseline changes, consumers compare the snapshot against the current `Token.surfaceText`
 * and flip `status` to `'stale'` on mismatch to prompt re-review.
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
   *   human review. Set by drift-detection logic comparing stored `TokenSnapshot.surfaceText`
   *   values against the current `Token.surfaceText`.
   */
  export type AssignmentStatus = 'approved' | 'suggested' | 'candidate' | 'rejected' | 'stale';

  // ---------------------------------------------------------------------------
  // Shared primitives
  // ---------------------------------------------------------------------------

  /**
   * A string value keyed by BCP 47 writing-system tag (e.g. `"en"`, `"fr"`, `"kmr-Latn"`). Keys
   * follow the IETF BCP 47 standard (language, optional script and region components). Consumers
   * should treat missing keys as "no value in that language" rather than an error.
   */
  export type MultiString = Record<string, string>;

  /**
   * A verse-level scripture reference that may optionally be anchored to a character position
   * within the verse's baseline text. When `charIndex` is absent the reference is verse-level
   * only.
   */
  export interface ScriptureRef {
    /** 3-letter SIL book code (e.g. `"GEN"`). */
    book: string;
    /** 1-based chapter number. */
    chapter: number;
    /** 1-based verse number. */
    verse: number;
    /**
     * Zero-based character offset within the verse's baseline text. Absent when the reference is
     * verse-level only (i.e. not anchored to a specific character position).
     */
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

    /**
     * Lexicon project identifier (FwData / Harmony code). Omit when there is only one Lexicon
     * project in context and the consumer can resolve it unambiguously.
     */
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

    /**
     * Lexicon project identifier (FwData / Harmony code). Omit when there is only one Lexicon
     * project in context and the consumer can resolve it unambiguously.
     */
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

    /**
     * Lexicon project identifier (FwData / Harmony code). Omit when there is only one Lexicon
     * project in context and the consumer can resolve it unambiguously.
     */
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

    /**
     * Lexicon project identifier (FwData / Harmony code). Omit when there is only one Lexicon
     * project in context and the consumer can resolve it unambiguously.
     */
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

    /**
     * Opaque version stamp of the book's baseline content at analysis time. In the current
     * implementation this is an FNV-1a 32-bit hex hash of the serialized USJ content (e.g.
     * `"a3f2c1b0"`). Consumers must treat it as an opaque string and compare only for equality — a
     * change in value means the baseline has changed and analyses may be stale.
     */
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
     * Stable identifier for this segment, unique within the owning `InterlinearProject`. In
     * practice the id is project-wide unique because it is set to the verse SID (e.g. `"GEN 1:1"`).
     * Used as the segment-side key by `SegmentAnalysisLink.segmentId`.
     */
    id: string;

    /**
     * Inclusive start of the text range. `charIndex` is set when a sub-verse character offset is
     * known.
     */
    startRef: ScriptureRef;

    /**
     * Inclusive end of the text range. `charIndex` is set when a sub-verse character offset is
     * known.
     */
    endRef: ScriptureRef;

    /**
     * Token character offsets (`Token.charStart` / `Token.charEnd`) are expressed relative to this
     * string, so it must be present for the text layer to be interpretable, particularly for
     * scriptio continua scripts where token boundaries are not derivable from whitespace.
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
     * Stable identifier for this token, unique within the owning `InterlinearProject`. In practice
     * the ref is project-wide unique because it embeds the verse SID and the token's character
     * offset (e.g. `"GEN 1:1:0"` for the first token in Genesis 1:1). Used as the token-side key by
     * `TokenAnalysisLink.token.tokenRef`, `PhraseAnalysisLink.tokens[*].tokenRef`, and
     * `AlignmentEndpoint.token.tokenRef`.
     */
    ref: string;

    /** The token's text as it appears in the baseline. */
    surfaceText: string;

    /** BCP 47 writing-system tag for `surfaceText`. */
    writingSystem: string;

    /**
     * Whether this token is a word or punctuation. This is a text-layer classification only — it
     * describes what the token looks like in the baseline, not how it is analyzed. Linguistic
     * analysis (POS, morphemes, glosses) lives in the parallel `TokenAnalysis` in the analysis
     * layer. Punctuation tokens typically have no corresponding `TokenAnalysis`.
     */
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
   * Flat by design — it does **not** mirror the text layer's book / segment nesting. Analysis
   * payload records are linked to the text layer through the corresponding `*AnalysisLinks` arrays.
   * Consumers that need segment-local views build indexes from those links at load time.
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
     * Per-segment analysis payload records. Carries only segment-level data (free / literal
     * translations); token-level data lives in `tokenAnalyses`.
     *
     * Competing analyses are permitted: a single segment may have multiple linked `SegmentAnalysis`
     * entries (e.g. an AI-drafted back translation alongside a human-edited one), distinguished by
     * `status` / `confidence` / `producer`.
     *
     * **Invariant:** for a given segment, at most one linked `SegmentAnalysisLink` should have
     * `status: 'approved'`. That linked analysis is the canonical segment-level analysis for
     * rendering; alternates are available to review workflows via the other statuses. This
     * invariant is the caller's responsibility to maintain; no runtime enforcement exists.
     */
    segmentAnalyses: SegmentAnalysis[];

    /**
     * Links each `SegmentAnalysis.id` to a single `Segment.id`, along with review metadata for that
     * assignment.
     */
    segmentAnalysisLinks: SegmentAnalysisLink[];

    /**
     * Token-level analysis payload records, flat across the whole text. The text layer keeps every
     * token (words and punctuation) but this list typically includes only tokens being analyzed —
     * punctuation is omitted rather than stored with empty analyses.
     *
     * Competing analyses are permitted: a single token may have multiple linked `TokenAnalysis`
     * entries (e.g. a parser's suggestion alongside a human's choice), distinguished by `status` /
     * `confidence` / `producer`.
     *
     * **Invariant:** for a given token, at most one linked `TokenAnalysisLink` should have `status:
     * 'approved'`. That linked analysis is the canonical analysis for rendering; alternates are
     * available to review workflows via the other statuses (`'suggested'`, `'candidate'`,
     * `'rejected'`, `'stale'`). This invariant is the caller's responsibility to maintain; no
     * runtime enforcement exists.
     */
    tokenAnalyses: TokenAnalysis[];

    /**
     * Links each `TokenAnalysis.id` to one token snapshot, along with review metadata for that
     * assignment.
     */
    tokenAnalysisLinks: TokenAnalysisLink[];

    /**
     * Multi-token phrase analyses, flat across the whole text. A phrase may group adjacent or
     * disjoint tokens and carries its own gloss. A phrase's member tokens may span multiple
     * segments.
     *
     * Competing phrases are permitted: a given token may appear in multiple linked `PhraseAnalysis`
     * records (e.g. a suggested phrase grouping plus a human-approved one) distinguished by
     * `status`.
     *
     * **Invariants:**
     *
     * - At most one linked `PhraseAnalysisLink` containing a given token should have `status:
     *   'approved'`. That phrase is canonical for rendering.
     * - A token may carry both a `TokenAnalysis` _and_ an approved `PhraseAnalysis`; the per-token
     *   parse coexists with the phrase-level gloss and is not a competing analysis.
     */
    phraseAnalyses: PhraseAnalysis[];

    /**
     * Links each `PhraseAnalysis.id` to one or more token snapshots, along with review metadata for
     * that assignment.
     */
    phraseAnalysisLinks: PhraseAnalysisLink[];
  }

  /** Shared link metadata for attaching an analysis payload record to text-layer targets. */
  export interface AnalysisLink {
    /** The `Analysis.id` for the linked analysis payload record. */
    analysisId: string;

    /** Review status of this analysis assignment. */
    status: AssignmentStatus;

    /** How much to trust this analysis assignment. */
    confidence?: Confidence;
  }

  /** Links one `SegmentAnalysis` payload record to a single source segment. */
  export interface SegmentAnalysisLink extends AnalysisLink {
    /** Reference to the corresponding `Segment.id` in the text layer. */
    segmentId: string;
  }

  /**
   * Shared base for all analysis payload record types (`SegmentAnalysis`, `TokenAnalysis`,
   * `PhraseAnalysis`). Carries fields common to each analysis payload: stable identity, token
   * surface text, and optional provenance.
   */
  export interface Analysis {
    /** Unique within the owning `TextAnalysis` — stable reference for this record. */
    id: string;

    /** Surface form of the analyzed text span (token, phrase, or segment). */
    surfaceText: string;

    /**
     * How much to trust this analysis. Independent of who produced it — see `producer` /
     * `sourceUser`.
     */
    confidence?: Confidence;

    /**
     * Free-form tag identifying what produced this analysis — e.g. `"human"`, `"parser"`,
     * `"eflomal"`, or a specific tool name.
     */
    producer?: string;

    /**
     * User identifier for human-created or human-edited analyses. Omitted for purely
     * machine-generated entries. Both `producer` and `sourceUser` may be set simultaneously when a
     * human uses a tool-assisted workflow; `producer` names the tool and `sourceUser` identifies
     * the human reviewer.
     */
    sourceUser?: string;
  }

  /**
   * Per-segment analysis payload record. Carries data that belongs to a segment as a whole (free /
   * literal translations). Token analyses and phrases live on `TextAnalysis` directly.
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
  export interface SegmentAnalysis extends Analysis {
    /** Idiomatic translation of the segment. */
    freeTranslation?: MultiString;

    /** Word-for-word translation. May be generated from token glosses. */
    literalTranslation?: MultiString;
  }

  // ---------------------------------------------------------------------------
  // §3 TokenAnalysis — parse + 1:1 gloss
  // ---------------------------------------------------------------------------

  /** Links one `TokenAnalysis` payload record to exactly one token snapshot. */
  export interface TokenAnalysisLink extends AnalysisLink {
    /** Token that this analysis refers to. */
    token: TokenSnapshot;
  }

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
  export interface TokenAnalysis extends Analysis {
    /**
     * Ordered morpheme breakdown. Present when the analysis reaches sub-word granularity (e.g. an
     * LCM `IWfiAnalysis` with `MorphBundlesOS`). Absent when the analysis treats the token as a
     * single whole-word unit.
     */
    morphemes?: MorphemeAnalysis[];

    /** Part of speech (free-form tag or lexicon POS id). */
    pos?: string;

    /**
     * Morphosyntactic features as a flat attribute-value map (e.g. `{ Case: "Nom", Number: "Sg"
     * }`).
     */
    features?: Record<string, string>;

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
  }

  /**
   * Analysis of one morpheme within a token's parse. `MorphemeAnalysis` owns the morpheme itself:
   * `form` and `writingSystem` store the structural data directly, while the optional refs link it
   * into the Lexicon extension for lexical resolution.
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
  export interface MorphemeAnalysis {
    /**
     * Unique within the owning `TokenAnalysis.morphemes` array — used as the cross-reference key by
     * `MorphemeLink.morphemeId`.
     */
    id: string;

    /** The morpheme form as it appears in this analysis (surface text). */
    form: string;

    /** Writing system of `form`. */
    writingSystem: string;

    /**
     * Lexicon entry this morpheme resolves to. Present for most analyzed morphemes; absent when the
     * morpheme has not yet been linked to a lexicon entry (e.g. an unreviewed parser suggestion).
     */
    entryRef?: EntryRef;

    /**
     * Specific sense of the entry used here. Requires `entryRef` to be meaningful; absent when the
     * entry has not been sense-disambiguated.
     */
    senseRef?: SenseRef;

    /**
     * Specific allomorph (surface variant) within the entry — an `IMoForm` in the Lexicon
     * extension. Absent when allomorph-level detail is not available (e.g. BT Extension imports).
     */
    allomorphRef?: AllomorphRef;

    /**
     * Morphosyntactic analysis (MSA) — grammar / POS information tied to this (entry × sense ×
     * allomorph) usage. Points at an `IMoMorphSynAnalysis` in the Lexicon extension (pending direct
     * exposure — see `GrammarRef`). Absent when MSA-level detail is not available.
     */
    grammarRef?: GrammarRef;

    /**
     * Free-form gloss string keyed by BCP 47 analysis-language tag. Analogous to
     * `TokenAnalysis.gloss` but scoped to a single morpheme. Takes precedence over any gloss
     * resolved through `senseRef` when both are present.
     */
    gloss?: MultiString;
  }

  // ---------------------------------------------------------------------------
  // §4 PhraseAnalysis — multi-token gloss unit
  // ---------------------------------------------------------------------------

  /** Links one `PhraseAnalysis` payload record to one or more token snapshots. */
  export interface PhraseAnalysisLink extends AnalysisLink {
    /** Ordered snapshots of tokens that compose this phrase (one or more). */
    tokens: TokenSnapshot[];
  }

  /**
   * A multi-token unit glossed or analyzed as a single phrase.
   *
   * The linked `PhraseAnalysisLink.tokens` list holds the token snapshots (in order) that belong to
   * the phrase. The tokens may be:
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
   *   when present, must be synthesized as `PhraseAnalysis` records during import.
   * - Paratext: a `LexemeCluster` with `Type = Phrase` spans multiple words — each such cluster
   *   becomes one `PhraseAnalysis` whose linked `PhraseAnalysisLink.tokens` enumerate the covered
   *   tokens. `senseRef` is the selected `LexemeData` reference for the phrase.
   * - BT Extension: not natively tracked. Must be synthesized during migration when adjacent tokens
   *   share the same gloss / sense.
   */
  export interface PhraseAnalysis extends Analysis {
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
  }

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

    /**
     * Free-form string describing how the alignment was produced — e.g. `"manual"`, `"eflomal"`,
     * `"import-bt"`. No controlled vocabulary is enforced; consumers should treat unknown values as
     * opaque. Absent when the origin was not recorded (e.g. legacy data or default-0 BT Extension
     * imports).
     */
    origin?: string;

    /**
     * Confidence in this alignment link, independent of the confidence on any token analyses at
     * either endpoint.
     */
    confidence?: Confidence;

    /** Multilingual notes keyed by BCP 47 writing-system tag (e.g. `'en'`, `'fr'`). */
    notes?: MultiString;
  }

  /**
   * One side of an alignment link.
   *
   * When `morphemeLink` is set the link connects at the morpheme level. Because a single token may
   * have multiple competing `TokenAnalysis` entries, `morphemeLink.tokenAnalysisId` is **required**
   * alongside `morphemeLink.morphemeId` to identify the specific `TokenAnalysis` that owns the
   * referenced morpheme. When `morphemeLink` is absent the link connects to the whole token.
   *
   * Resolution chain (morpheme-level): AlignmentEndpoint → Token (via `token.tokenRef`) →
   * TokenAnalysis (via `morphemeLink.tokenAnalysisId`) → MorphemeAnalysis (via
   * `morphemeLink.morphemeId`) → EntryRef → `IEntry` (Lexicon extension) → SenseRef → `ISense`
   * (Lexicon extension)
   *
   * Resolution chain (token-level): AlignmentEndpoint → Token (via `token.tokenRef`) →
   * `Token.surfaceText` (display) / `TokenAnalysis[]` (analysis, looked up by `tokenRef`)
   *
   * Source-system mapping:
   *
   * - LCM / Paratext: endpoints produced only through external tools or parallel-project inference
   *   (see `AlignmentLink`).
   * - BT Extension: one endpoint per `Instance` in an `Alignment`'s `sourceInstances` /
   *   `targetInstances`. `morphemeLink` is set when the token has a morpheme-level parse; otherwise
   *   the endpoint targets the whole token.
   */
  export interface AlignmentEndpoint {
    /**
     * Token targeted by this endpoint. Identifies the token via `tokenRef` and carries a surface
     * text snapshot for drift detection.
     */
    token: TokenSnapshot;

    /**
     * When set, narrows the endpoint to a specific morpheme within the token's parse. When absent,
     * the endpoint targets the whole token.
     */
    morphemeLink?: MorphemeLink;
  }

  /**
   * A snapshot of a token at the time an alignment endpoint was created. Carries the stable token
   * reference and a copy of its surface text for drift detection.
   */
  export interface TokenSnapshot {
    /** `Token.ref` of the targeted token. */
    tokenRef: string;

    /**
     * Surface text of the token at link-creation time — used for drift detection. A link whose
     * endpoint snapshot no longer matches the current `Token.surfaceText` is stale; consumers flip
     * the link's `status` to `'stale'` to prompt re-review.
     */
    surfaceText: string;
  }

  /**
   * Identifies a specific morpheme within a token's parse for morpheme-level alignment endpoints.
   * Both fields are required together: `tokenAnalysisId` selects the `TokenAnalysis` (since a token
   * may have multiple competing analyses) and `morphemeId` selects the morpheme within it.
   */
  export interface MorphemeLink {
    /** The `TokenAnalysis.id` that owns the referenced morpheme. */
    tokenAnalysisId: string;

    /** Specific `MorphemeAnalysis.id` within the identified `TokenAnalysis.morphemes`. */
    morphemeId: string;
  }

  // ---------------------------------------------------------------------------
  // §6 InterlinearProject — persisted project envelope
  // ---------------------------------------------------------------------------

  /**
   * The storage envelope for one interlinearizer project. Multiple projects may exist for the same
   * source project (e.g. different analysis languages, or different target alignments).
   *
   * The token hierarchy (`Book` / `Segment` / `Token`) is **not** stored here — it is rebuilt from
   * Platform.Bible's USJ on each load. Only the analysis data and alignment links are persisted.
   * Token-level drift is detected via `token.surfaceText` snapshots on `AlignmentEndpoint`
   * records.
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
     * BCP 47 tags for all languages used in glosses and annotations (e.g. `['en']`). Populates
     * `MultiString` keys in `TokenAnalysis`, `SegmentAnalysis`, and `PhraseAnalysis` records.
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
     * Token- or morpheme-level alignment links. Absent (`undefined`) at creation for analysis-only
     * projects; present (possibly empty) for bilateral alignment projects. Populated as the user
     * aligns source and target tokens.
     */
    links?: AlignmentLink[];
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
