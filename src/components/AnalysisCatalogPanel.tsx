import { logger } from '@papi/frontend';
import { useSetting } from '@papi/frontend/react';
import { X } from 'lucide-react';
import { Button, EmptyState, TooltipProvider } from 'platform-bible-react';
import {
  formatReplacementString,
  isPlatformError,
  type LanguageStrings,
} from 'platform-bible-utils';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  useAnalysisDeletionOutcome,
  useAnalysisLanguage,
  useAnalysisReadOnly,
  useAnalysisRowDispatch,
  useConfirmMorphemesDispatch,
  useGlossClearReclaims,
  useReportGlossEditing,
  useStaleLocationDispatch,
  useStaleLocationReclaims,
} from './AnalysisStore';
import type { AnalysisEditOutcome } from '../utils/edit-outcome';
import { breakdownDraftForms, createGlossRetry } from './CatalogRowEditor';
import CatalogCloseModal, { CLOSE_STRING_KEYS } from './CatalogCloseModal';
import CatalogMergeModal, { MERGE_STRING_KEYS } from './CatalogMergeModal';
import type { MergedContentDraft } from '../utils/merge-content';
import CatalogMergeNotice, {
  CatalogStrandedDraftNotice,
  MERGE_NOTICE_STRING_KEYS,
  mergeNoticeMessage,
  type MergeNotice,
  type StrandedDraftNotice,
} from './CatalogMergeNotice';
import CatalogQueryControls, { QUERY_CONTROL_STRING_KEYS } from './CatalogQueryControls';
import CatalogList from './CatalogList';
import CatalogRowView, { ROW_STRING_KEYS } from './CatalogRowView';
import CatalogSelectionBar, { SELECTION_BAR_STRING_KEYS } from './CatalogSelectionBar';
import SidePanelTabs, { SIDE_PANEL_TAB_STRING_KEYS } from './SidePanelTabs';
import TextReadingStatus, { TEXT_READING_STRING_KEYS } from './TextReadingStatus';
import { useInterlinearNav } from './InterlinearNavContext';
import useDraftDiscardGate from '../hooks/useDraftDiscardGate';
import useRowSelection from '../hooks/useRowSelection';
import useRowWindow from '../hooks/useRowWindow';
import { whenSettled, type Settles } from '../utils/settles';
import {
  useCatalogReads,
  useCatalogRowsByIds,
  useCatalogView,
  useHomographRows,
  useSelectionSummary,
  useTextReadStatus,
} from '../cache/catalogHooks';
import {
  DELETION_ANNOUNCEMENT_STRING_KEYS,
  deletionAnnouncement,
} from '../utils/deletion-announcement';
import {
  reconcileFilters,
  type CatalogFilters,
  type CatalogFacets,
  type CatalogRow,
  type CatalogSort,
  type CatalogUsage,
} from '../utils/analysis-query';
import { languageNameForTag } from '../utils/language-tags';

/** How many rows the panel first asks the host for, enough to fill the window it first mounts. */
const INITIAL_FETCH_COUNT = 40;

/** Tells no one about an edit, having no history to undo it from. */
const ANNOUNCE_NOTHING = () => {};

/**
 * `read`, for an edit to use once the edit settles, resolving `undefined` if the read fails.
 *
 * Logs the failure as soon as it lands, because an edit that fails never awaits its read.
 */
function readForEdit<T>(read: Promise<T>): Promise<T | undefined> {
  return read.catch((e) => {
    logger.warn('Interlinearizer: could not read the uses an edit reached', e);
    return undefined;
  });
}

/** Calls `then` with the count once it arrives, unless it could not be had. */
async function afterCounting(counted: Promise<number | undefined>, then: (count: number) => void) {
  const count = await counted;
  if (count !== undefined) then(count);
}

/** How many tokens the rows `analysisIds` names are used at, a token carrying several counting once. */
function distinctUsageCount(rows: readonly CatalogRow[], analysisIds: ReadonlySet<string>): number {
  return new Set(
    rows
      .filter((r) => analysisIds.has(r.analysisId))
      .flatMap((r) => r.usages.map((u) => u.tokenRef)),
  ).size;
}

/**
 * The announcement for a gloss clear that deleted or merged at least one record, phrased for
 * whichever it did.
 */
function clearedGlossKey(deletedCount: number, mergedCount: number) {
  if (mergedCount === 0) return '%interlinearizer_analysisCatalog_clearedGlossDeleted%';
  if (deletedCount === 0) return '%interlinearizer_analysisCatalog_clearedGlossMerged%';
  return '%interlinearizer_analysisCatalog_clearedGlossDeletedAndMerged%';
}

/**
 * Localized string keys the panel needs, the rows' among them so the list resolves once rather than
 * once per analysis.
 */
export const ANALYSIS_CATALOG_PANEL_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_clearedGlossDeleted%',
  '%interlinearizer_analysisCatalog_clearedGlossDeletedAndMerged%',
  '%interlinearizer_analysisCatalog_clearedGlossMerged%',
  '%interlinearizer_analysisCatalog_close%',
  '%interlinearizer_analysisCatalog_deletedChecked%',
  '%interlinearizer_analysisCatalog_empty%',
  '%interlinearizer_analysisCatalog_mergedEmpty%',
  '%interlinearizer_analysisCatalog_usageCountInBook%',
  '%interlinearizer_analysisCatalog_noMatches%',
  ...TEXT_READING_STRING_KEYS,
  ...QUERY_CONTROL_STRING_KEYS,
  ...ROW_STRING_KEYS,
  ...SELECTION_BAR_STRING_KEYS,
  ...MERGE_NOTICE_STRING_KEYS,
  ...MERGE_STRING_KEYS,
  ...DELETION_ANNOUNCEMENT_STRING_KEYS,
  ...CLOSE_STRING_KEYS,
  ...SIDE_PANEL_TAB_STRING_KEYS,
] as const satisfies `%${string}%`[];

/**
 * Blurs the focused element when it sits within `panel`. Blurring sends a focused gloss field's
 * draft at once; a field outside the panel keeps its focus and its unsent text.
 */
function blurFocusedField(panel: HTMLElement | undefined): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && panel?.contains(focused)) focused.blur();
}

/** A breakdown a row is holding, with the form it was typed against. */
type BreakdownDraft = Readonly<{
  /** The breakdown as a line of space-separated forms. */
  text: string;
  /** The analysis's surface form when the draft was opened, which names it once the record is gone. */
  surfaceText: string;
}>;

/** What {@link AnalysisCatalogPanel} lets its owner do through a ref. */
export type AnalysisCatalogPanelHandle = Readonly<{
  /**
   * Switches to the concordance once the gloss commits in flight settle, asking first when unsaved
   * catalog edits would be lost.
   */
  requestShowConcordance: () => void;
  /** Scrolls to the row for `analysisId` when the listing holds it. */
  revealRow: (analysisId: string) => void;
  /** Narrows the listing to exactly `filters`, clearing the search so nothing else hides a row. */
  filterTo: (filters: CatalogFilters) => void;
}>;

/** A merge picker being opened. */
type MergeRequest = Readonly<{
  /** The row the picker opens on, which names the form whose analyses it lists. */
  analysisId: string;
  /** The rows the picker starts out folding into that one. */
  mergedIds: readonly string[];
}>;

/** Props for {@link AnalysisCatalogPanel}. */
type AnalysisCatalogPanelProps = Readonly<{
  /** Receives the panel's handle, for a switch requested from outside the panel. */
  ref?: Ref<AnalysisCatalogPanelHandle>;
  /** Dismisses the panel. */
  onClose: () => void;
  /** Switches the side panel to the concordance. */
  onShowConcordance: () => void;
  /** Tells the reader what an edit just did, offering to undo it; silent when omitted. */
  announceUndoable?: (message: string) => void;
  /** Book code each row's per-book usage count is taken against. */
  currentBook: string;
  /** Reads the loaded book's current text for a token ref, `undefined` for one in any other book. */
  liveSurfaceText: (tokenRef: string) => string | undefined;
  /** Whether this project breaks words into morphemes, which the breakdown filter is offered for. */
  showMorphology: boolean;
  /** BCP 47 tag of the source text, so surface forms collate by their own language. */
  sourceLanguageTag: string;
  /** Resolved localizations covering at least {@link ANALYSIS_CATALOG_PANEL_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
  /** What the current book is called wherever the panel names it in prose. */
  currentBookName: string;
}>;

/**
 * The analysis catalog: every analysis the draft records, listed with the usage data the catalog
 * lists it by, and editable in place.
 *
 * Every write from here is keyed by the analysis rather than by a token, so it changes what a
 * record says for every token linked to it — one correction fixes a mis-split word across all its
 * occurrences. That is the opposite of an edit made in the interlinear view, which forks a shared
 * payload to keep itself local to one token.
 *
 * Sits beside the interlinear view rather than over it, so a jump to a usage can move the view
 * while the list the jump came from stays on screen.
 */
export default function AnalysisCatalogPanel({
  ref,
  onClose,
  onShowConcordance,
  announceUndoable = ANNOUNCE_NOTHING,
  currentBook,
  liveSurfaceText,
  showMorphology,
  sourceLanguageTag,
  localizedStrings,
  currentBookName,
}: AnalysisCatalogPanelProps) {
  const analysisLanguage = useAnalysisLanguage();

  /**
   * What the reader has typed into the search box. Ephemeral rather than persisted: the panel is
   * mounted only while it is open, so closing it clears the query — a filter that outlived a reload
   * would leave rows missing with nothing on screen saying why.
   */
  const [search, setSearch] = useState('');

  /** How the listing is ordered. Most-used first, the question the catalog is opened to answer. */
  const [sort, setSort] = useState<CatalogSort>('usageCount');

  /**
   * Which rows the listing keeps, as the reader last chose them. A choice here can be withdrawn by
   * an edit made beside the panel, so it is the reconciled set below that narrows the listing until
   * the withdrawal is committed back over these.
   */
  const [chosenFilters, setFilters] = useState<CatalogFilters>({});

  /** Whether a filter has asked for the whole text. Asking how far the read has got starts it. */
  const [isTextWanted, setTextWanted] = useState(false);

  // Covers every way filters get set, not just the controls.
  useEffect(() => {
    if (chosenFilters.notInText || chosenFilters.stale) setTextWanted(true);
  }, [chosenFilters.notInText, chosenFilters.stale]);

  const readStatus = useTextReadStatus(isTextWanted);

  /** How many rows the host is asked for: at least as many as the window has mounted. */
  const [fetchCount, setFetchCount] = useState(INITIAL_FETCH_COUNT);

  /** The listing that {@link fetchCount} grew against, so a new one can be recognized as new. */
  const [fetchedListing, setFetchedListing] = useState<unknown>(undefined);

  /**
   * The filter choices the latest page offered, or `undefined` until a page arrives. Until then the
   * reader's filters stand as chosen.
   */
  const [facets, setFacets] = useState<CatalogFacets | undefined>(undefined);

  /**
   * The filters actually narrowing the listing: the reader's choices less any the facets have since
   * withdrawn. An edit beside the panel can remove the last row carrying a chosen value, which
   * takes that facet's control off screen; keeping the choice would narrow the list to nothing with
   * no control left to widen it back by. The facets are taken against every row the draft holds
   * rather than the rows a filter left standing, so each page names the same ones whatever it
   * asks.
   */
  const filters = useMemo(
    () => (facets ? reconcileFilters(chosenFilters, facets) : chosenFilters),
    [chosenFilters, facets],
  );

  // Commits a withdrawal back over the choices, so a dropped value cannot return with its facet and
  // narrow the listing by a filter the reader watched release. Settles after one withdrawal, the
  // reconciled filters being the chosen set itself once every choice survives.
  if (filters !== chosenFilters) setFilters(filters);

  /**
   * What the host is asked to list. It changes with the analysis language too, because the host
   * reads each row's gloss in that language.
   */
  const request = useMemo(
    () => ({ currentBook, search, sort, filters, sourceLanguageTag }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new language lists new glosses
    [currentBook, search, sort, filters, sourceLanguageTag, analysisLanguage],
  );

  const view = useCatalogView(request, fetchCount);
  if (view && view.facets !== facets) setFacets(view.facets);
  const keptIds = useMemo(() => view?.keptIds ?? [], [view]);
  const rowCount = view?.rowCount ?? 0;

  /** The ids of the rows the listing keeps, in the shape the selection and the window take. */
  const rows = useMemo(() => keptIds.map((analysisId) => ({ analysisId })), [keptIds]);

  /** Whether every book of the text has been read, none failing. */
  const isTextRead =
    readStatus !== undefined &&
    readStatus !== 'error' &&
    readStatus.booksRead === readStatus.bookCount &&
    readStatus.failedBookIds.length === 0;

  /** Whether the not-in-text filter is on before the whole text has been read. */
  const isAwaitingText = filters.notInText && !isTextRead;

  /**
   * Label every row carries for its per-book usage count, resolved once for the whole list. Names
   * the book rather than giving its code, because this label reads as prose where the usage links
   * below it read as references.
   */
  const usageCountInBookLabel = useMemo(
    () =>
      formatReplacementString(
        localizedStrings['%interlinearizer_analysisCatalog_usageCountInBook%'],
        { book: currentBookName },
      ),
    [localizedStrings, currentBookName],
  );

  const [interfaceLanguages] = useSetting('platform.interfaceLanguage', ['und']);

  /**
   * What the analysis language is called, for the filter that asks after a missing gloss to name it
   * in prose: the question is about a language rather than about a code, and a reader who never
   * chose the tag has no reason to recognize it.
   *
   * Named in the interface's own languages rather than the host's, which the platform's interface
   * language does not follow — a name resolved against the host would read in one language beside a
   * label resolved in another.
   */
  const analysisLanguageName = useMemo(() => {
    /* v8 ignore next -- useSetting never returns PlatformError for this key in practice */
    const locales = isPlatformError(interfaceLanguages) ? undefined : interfaceLanguages;
    return languageNameForTag(analysisLanguage, locales);
  }, [analysisLanguage, interfaceLanguages]);

  /**
   * The analysis language where it decides the listing's rows or their order, and `undefined`
   * elsewhere. Elsewhere its collation can reorder only homographs that tie on the sort key. Those
   * stay adjacent, so the scroll position holds even when they trade places.
   */
  const listingGlossLanguage =
    sort === 'gloss' || filters.missingGloss ? analysisLanguage : undefined;

  /**
   * Everything that decides which listing is on screen. The book counts alongside the query because
   * each row's per-book usage is taken against it: moving to another book reorders a listing sorted
   * by that count, and relabels that column in every other.
   */
  const listing = useMemo(
    () => ({ search, sort, filters, sourceLanguageTag, listingGlossLanguage, currentBook }),
    [search, sort, filters, sourceLanguageTag, listingGlossLanguage, currentBook],
  );

  /**
   * What the last edit's collapse left standing, or `undefined` when no edit has collapsed one.
   * Kept until dismissed or superseded: the reader may be looking anywhere in the list when an edit
   * commits, and a row that vanishes unexplained reads as data loss.
   */
  const [mergeNotice, setMergeNotice] = useState<MergeNotice | undefined>(undefined);

  /**
   * The row to bring into view once, not again each time it remounts: the one a merge notice names,
   * or the one an undo or redo acted on.
   */
  const [rowToReveal, setRowToReveal] = useState<Readonly<{ analysisId: string }> | undefined>(
    undefined,
  );

  /** The rows the host has sent, by id. */
  const sentRows = useMemo(() => new Map(view?.rows.map((row) => [row.analysisId, row])), [view]);

  // The reveal request holds until the host sends its row, because a row past the fetched page
  // mounts only once the larger page arrives.
  useEffect(() => {
    if (rowToReveal && sentRows.has(rowToReveal.analysisId)) setRowToReveal(undefined);
  }, [rowToReveal, sentRows]);

  /** Raises a merge notice, taking the reader to the row it names. */
  const showMergeNotice = useCallback((notice: MergeNotice) => {
    setMergeNotice(notice);
    setRowToReveal({ analysisId: notice.survivingAnalysisId });
  }, []);

  /**
   * Where the row to reveal sits in the listing, or `undefined` when there is none or the listing
   * does not hold it; that row can sit anywhere, so it is not otherwise within the mounted window.
   */
  const revealedRowIndex = useMemo(() => {
    if (!rowToReveal) return undefined;
    const index = keptIds.indexOf(rowToReveal.analysisId);
    /* v8 ignore next -- the window ignores -1 just as it does undefined */
    return index === -1 ? undefined : index;
  }, [keptIds, rowToReveal]);

  /**
   * The slice of the listing that is actually mounted. A draft accumulates analyses without bound
   * and every row carries its own expander and usage list, so the list grows as it is scrolled
   * rather than rendering whole.
   */
  const { windowRows, scrollRef, sentinelRef } = useRowWindow(rows, listing, revealedRowIndex);
  // Reset with the window, so a new listing is not fetched at the size an earlier one scrolled to.
  if (listing !== fetchedListing) {
    setFetchedListing(listing);
    setFetchCount(INITIAL_FETCH_COUNT);
  } else if (windowRows.length > fetchCount) setFetchCount(windowRows.length);

  const { navigate, requestFocusToken, cancelFocusRequest } = useInterlinearNav();

  /**
   * The analysis whose usage was last jumped to, or `undefined` before any jump. Marks where in the
   * list the view came from, so a jump that scrolls the text away does not also lose the reader's
   * place in the catalog.
   */
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | undefined>(undefined);

  /**
   * Moves the interlinear view to a usage: the verse it sits in, then the token itself.
   *
   * The focus request is raised before the navigation so that it is already pending when the
   * reference moves. A request is abandoned only once the reference names a book other than the one
   * the request does, so a cross-book jump leaves it outstanding until that book's view mounts and
   * claims it.
   *
   * The navigation is external — the default — because a usage may name any verse in the draft, so
   * the view has to recenter on it rather than track it in place.
   */
  const handleUsageSelect = useCallback(
    (analysisId: string, usage: CatalogUsage) => {
      setSelectedAnalysisId(analysisId);
      requestFocusToken(usage.tokenRef);
      navigate({ book: usage.book, chapterNum: usage.chapter, verseNum: usage.verse });
    },
    [navigate, requestFocusToken],
  );

  /**
   * Moves the interlinear view to the verse of a place an analysis went stale at, focusing no token
   * — the place's own offset may belong to a different word by now — and withdrawing any request an
   * earlier jump left pending.
   */
  const handleStaleSelect = useCallback(
    (analysisId: string, location: CatalogUsage) => {
      setSelectedAnalysisId(analysisId);
      cancelFocusRequest();
      navigate({ book: location.book, chapterNum: location.chapter, verseNum: location.verse });
    },
    [cancelFocusRequest, navigate],
  );

  const rowDispatch = useAnalysisRowDispatch();
  const confirmMorphemes = useConfirmMorphemesDispatch();
  const readDeletionOutcome = useAnalysisDeletionOutcome();
  const readOnly = useAnalysisReadOnly();

  const { checkedIds, setChecked, setAllChecked } = useRowSelection(rows);

  /** The checked rows' ids in listing order, which picks a merge's survivor when uses tie. */
  const orderedCheckedIds = useMemo(
    () => keptIds.filter((analysisId) => checkedIds.has(analysisId)),
    [keptIds, checkedIds],
  );

  /** What a bulk action over the checked rows reaches. */
  const selection = useSelectionSummary(orderedCheckedIds);

  /** How many uses the checked rows have between them, which is what a bulk action reaches. */
  const checkedUsageCount = selection?.usageCount ?? 0;

  /** The checked rows carrying a gloss in the analysis language, which a gloss clear reaches. */
  const glossedCheckedIds = useMemo(() => selection?.glossedIds ?? [], [selection]);

  const reads = useCatalogReads(currentBook);

  /** Announces the message an edit's use count completes, once that count arrives. */
  const announceCounted = useCallback(
    (counted: Promise<number | undefined>, message: (usageCount: number) => string) =>
      afterCounting(counted, (usageCount) => announceUndoable(message(usageCount))),
    [announceUndoable],
  );

  /**
   * The merge picker that is open, or `undefined` when none is.
   *
   * Held as ids rather than as rows, so a listing that turns over beneath an open modal cannot
   * leave it holding a stale copy of what it is about to act on.
   */
  const [mergeRequest, setMergeRequest] = useState<MergeRequest | undefined>(undefined);

  /**
   * The breakdown draft each row is holding, keyed by analysis id, for the rows holding one. Kept
   * here rather than in the row because a row unmounts whenever it is collapsed or a query stops
   * listing it, and the breakdown commits on neither blur nor unmount — so a draft left in the row
   * would go with it, taking a re-segmentation the reader typed but had not saved.
   *
   * Each entry carries the form it was typed against, so a draft outliving its record can still be
   * reported by the word the reader was working on.
   */
  const [breakdownDrafts, setBreakdownDrafts] = useState<ReadonlyMap<string, BreakdownDraft>>(
    new Map(),
  );

  /** Whether {@link glossRetry} holds a gloss draft that the panel's closing would discard. */
  const [holdsUnsavedGloss, setHoldsUnsavedGloss] = useState(false);

  /**
   * The gloss drafts no field is showing, and the fields showing a draft whose commit failed. Kept
   * here rather than in the row because a row's fields unmount when the row is collapsed or no
   * longer listed, or when the analysis language changes. Kept drafts go with the panel when it
   * closes; closing asks first for that reason.
   */
  const [glossRetry] = useState(() => createGlossRetry(setHoldsUnsavedGloss));

  const handleBreakdownDraftChange = useCallback(
    (analysisId: string, draft: string | undefined, surfaceText: string) => {
      setBreakdownDrafts((drafts) => {
        const next = new Map(drafts);
        if (draft === undefined) next.delete(analysisId);
        else next.set(analysisId, { text: draft, surfaceText });
        return next;
      });
    },
    [],
  );

  /** Drops a row's breakdown draft, for the paths that end one without the row reporting it. */
  const discardBreakdownDraft = useCallback((analysisId: string) => {
    setBreakdownDrafts((drafts) => {
      if (!drafts.has(analysisId)) return drafts;
      const next = new Map(drafts);
      next.delete(analysisId);
      return next;
    });
  }, []);

  /**
   * The analyses a draft is held against, a breakdown or a kept gloss, whose rows may sit anywhere
   * in the listing or outside it. Read from the gloss drafts at each render, which every change to
   * the catalog brings.
   */
  const keptGlossIds = glossRetry.keptAnalysisIds();
  const trackedIdsKey = JSON.stringify([...new Set([...breakdownDrafts.keys(), ...keptGlossIds])]);
  const trackedIds: readonly string[] = useMemo(() => JSON.parse(trackedIdsKey), [trackedIdsKey]);

  /** The rows of {@link trackedIds}. An analysis that is no longer stored has none. */
  const trackedRows = useCatalogRowsByIds(trackedIds, currentBook);

  // A draft that no field can show again would otherwise hold the unsaved mark on for good.
  useEffect(() => {
    if (trackedRows) glossRetry.prune([...trackedRows.values()], new Set(trackedIds));
  }, [trackedRows, trackedIds, glossRetry]);

  /** The row for `analysisId`, from those the host has sent, or `undefined` when none has. */
  const rowOf = useCallback(
    (analysisId: string): CatalogRow | undefined =>
      trackedRows?.get(analysisId) ?? sentRows.get(analysisId),
    [trackedRows, sentRows],
  );

  /**
   * Whether one row is holding a breakdown the reader has changed but not saved. Measured against
   * what the editor pre-filled, so a draft left untouched is not unsaved work.
   */
  const rowHasUnsavedBreakdown = useCallback(
    (analysisId: string) => {
      const row = rowOf(analysisId);
      const draft = row && breakdownDrafts.get(analysisId);
      if (row === undefined || draft === undefined) return false;
      const prefilled = row.morphemes.map((m) => m.form).join(' ') || row.surfaceText;
      return breakdownDraftForms(draft.text).join(' ') !== breakdownDraftForms(prefilled).join(' ');
    },
    [rowOf, breakdownDrafts],
  );

  /** Whether any row is holding a breakdown the reader has changed but not saved. */
  const hasUnsavedBreakdown = useMemo(
    () => [...breakdownDrafts.keys()].some(rowHasUnsavedBreakdown),
    [breakdownDrafts, rowHasUnsavedBreakdown],
  );

  /** Whether leaving the panel would discard a breakdown draft or a gloss that is not saved. */
  const hasUnsavedEdits = hasUnsavedBreakdown || holdsUnsavedGloss;

  // No flush on unmount: a breakdown draft is saved or discarded explicitly, and an unsent gloss
  // waits for its field to mount again, so neither is sent on the way out.
  useReportGlossEditing(hasUnsavedEdits, () => {});

  /**
   * The draft an edit made outside the panel stranded, or `undefined` when none has been. Kept
   * until dismissed or superseded, as the merge notice is: the reader may be looking anywhere when
   * the row they were typing into goes.
   */
  const [strandedDraft, setStrandedDraft] = useState<StrandedDraftNotice | undefined>(undefined);

  /**
   * Reports and clears any draft whose analysis is no longer in the listing.
   *
   * An edit in the view beside the panel can drop the very record a draft is keyed to, taking the
   * row out from under the reader mid-edit. Left in hand the draft would strand under an id that
   * can never return, counting as no unsaved work: the tab's unsaved mark would clear and closing
   * would stop asking.
   */
  useEffect(() => {
    if (!trackedRows) return;
    const stranded = [...breakdownDrafts].find(
      ([analysisId]) => trackedIds.includes(analysisId) && !trackedRows.has(analysisId),
    );
    if (!stranded) return;
    const [analysisId, draft] = stranded;
    setStrandedDraft({ surfaceText: draft.surfaceText });
    discardBreakdownDraft(analysisId);
  }, [breakdownDrafts, trackedRows, trackedIds, discardBreakdownDraft]);

  /**
   * How the reader is leaving the panel while being asked to confirm it over unsaved edits, or
   * `undefined` while no such ask is open.
   */
  const [confirmingLeave, setConfirmingLeave] = useState<'close' | 'switch' | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement | undefined>(undefined);

  /**
   * Closes the panel, or asks first when a breakdown draft or an unsent gloss would go with it.
   *
   * Neither commits on the way out, so leaving the panel is the one route that can drop typed text
   * the reader never asked to discard.
   *
   * Waits first for the gloss commits in flight, the focused field's included, whatever triggered
   * the request. A commit that fails leaves its draft for the ask to cover.
   */
  const handleCloseRequest = useCallback(() => {
    blurFocusedField(panelRef.current);
    glossRetry.afterCommits(() => {
      if (hasUnsavedBreakdown || glossRetry.isHolding()) setConfirmingLeave('close');
      else onClose();
    });
  }, [glossRetry, hasUnsavedBreakdown, onClose]);

  /** Switches the side panel to the concordance, or asks first as closing does. */
  const handleSwitchRequest = useCallback(() => {
    blurFocusedField(panelRef.current);
    glossRetry.afterCommits(() => {
      if (hasUnsavedBreakdown || glossRetry.isHolding()) setConfirmingLeave('switch');
      else onShowConcordance();
    });
  }, [glossRetry, hasUnsavedBreakdown, onShowConcordance]);

  // A merge notice describes the latest edit, which an undo or redo has just moved past.
  const revealRow = useCallback((analysisId: string) => {
    setMergeNotice(undefined);
    setRowToReveal({ analysisId });
  }, []);

  const filterTo = useCallback((narrowedTo: CatalogFilters) => {
    setSearch('');
    setFilters(narrowedTo);
  }, []);

  useImperativeHandle(
    ref,
    () => ({ requestShowConcordance: handleSwitchRequest, revealRow, filterTo }),
    [handleSwitchRequest, revealRow, filterTo],
  );

  /**
   * Runs a row edit, then hands its result to `then` once it settles.
   *
   * @returns The edit's result, which rejects when the edit fails.
   */
  const runRowEdit = useCallback(
    <T,>(edit: () => Settles<T>, then: (settled: T) => void): Settles<T> => {
      const result = edit();
      whenSettled(result, then);
      return result;
    },
    [],
  );

  /**
   * Records what an edit did, so a collapse is reported rather than left to look like a vanished
   * row. An ordinary edit clears whatever the last one said, the notice naming the edit just made
   * rather than an older one.
   */
  const reportEditOutcome = useCallback(
    (outcome: AnalysisEditOutcome, surfaceText: string) => {
      if (outcome.kind === 'merged')
        showMergeNotice({
          survivingAnalysisId: outcome.survivingAnalysisId,
          survivingGloss: outcome.survivingGloss,
          surfaceText,
          usageCount: outcome.survivingUsageCount,
        });
      else setMergeNotice(undefined);
    },
    [showMergeNotice],
  );

  /**
   * The surface form of the row an edit came from, for a merge notice to name the survivor by when
   * it carries no gloss. The two share a form — a collapse only ever happens between homographs —
   * so the edited row's own is the survivor's too.
   */
  const surfaceTextOf = useCallback(
    (analysisId: string) =>
      /* v8 ignore next -- the id came from a row the host sent, so it always resolves */
      rowOf(analysisId)?.surfaceText ?? '',
    [rowOf],
  );

  const handleGlossCommit = useCallback(
    (analysisId: string, value: string) => {
      const form = surfaceTextOf(analysisId);
      return runRowEdit(
        () => rowDispatch.writeGloss(analysisId, value),
        (outcome) => reportEditOutcome(outcome, form),
      );
    },
    [reportEditOutcome, rowDispatch, runRowEdit, surfaceTextOf],
  );

  const handleMorphemesCommit = useCallback(
    (analysisId: string, forms: readonly string[]) => {
      const form = surfaceTextOf(analysisId);
      runRowEdit(
        () => rowDispatch.writeMorphemes(analysisId, forms, sourceLanguageTag),
        (outcome) => reportEditOutcome(outcome, form),
      );
    },
    [reportEditOutcome, rowDispatch, runRowEdit, sourceLanguageTag, surfaceTextOf],
  );

  const handleMorphemeGlossCommit = useCallback(
    (analysisId: string, morphemeId: string, value: string) => {
      const form = surfaceTextOf(analysisId);
      return runRowEdit(
        () => rowDispatch.writeMorphemeGloss(analysisId, morphemeId, value),
        (outcome) => reportEditOutcome(outcome, form),
      );
    },
    [reportEditOutcome, rowDispatch, runRowEdit, surfaceTextOf],
  );

  const handleMorphemesConfirm = useCallback(
    (analysisId: string) => confirmMorphemes(analysisId),
    [confirmMorphemes],
  );

  /**
   * Holds back an edit until the reader agrees to lose each breakdown they typed against a row it
   * would drop, a dropped record taking its draft with it.
   */
  const discardGate = useDraftDiscardGate<'delete' | 'clearGloss' | 'merge' | 'stale'>(
    rowHasUnsavedBreakdown,
    discardBreakdownDraft,
  );
  const requestDiscard = discardGate.request;

  /**
   * Asks about the unsaved breakdowns on the records that `readDroppedIds` names, then runs `run`
   * with them. Any untouched draft goes with its record rather than being reported stranded.
   */
  const requestDropping = useCallback(
    (
      action: 'clearGloss' | 'stale',
      readDroppedIds: () => Settles<readonly string[]>,
      run: (droppedIds: readonly string[]) => void,
    ) =>
      requestDiscard(action, readDroppedIds, (droppedIds) => {
        droppedIds.forEach(discardBreakdownDraft);
        run(droppedIds);
      }),
    [discardBreakdownDraft, requestDiscard],
  );

  /** Deletes the analysis `analysisId` names, announcing what the deletion did. */
  const deleteAnalysis = useCallback(
    (analysisId: string) => {
      const outcome = readDeletionOutcome(analysisId, liveSurfaceText);
      /* v8 ignore next -- the id came from a row of this very listing, so it always resolves */
      if (!outcome) return;
      const form = surfaceTextOf(analysisId);
      // Cleared before the record goes, so this removal is not reported back to the reader who
      // asked for it.
      discardBreakdownDraft(analysisId);
      runRowEdit(
        () => rowDispatch.deleteAnalyses([analysisId]),
        () => {
          // A deleted row cannot be the one a merge notice points at, and leaving the notice up
          // would send the reader to a row that is no longer there.
          setMergeNotice(undefined);
          announceUndoable(deletionAnnouncement(form, outcome, localizedStrings));
        },
      );
    },
    [
      announceUndoable,
      discardBreakdownDraft,
      liveSurfaceText,
      localizedStrings,
      readDeletionOutcome,
      rowDispatch,
      runRowEdit,
      surfaceTextOf,
    ],
  );

  /** Deletes the analyses `analysisIds` names as one step, announcing how many uses they had. */
  const deleteChecked = useCallback(
    (analysisIds: readonly string[]) => {
      const count = analysisIds.length;
      // Counted before the records go, which takes their uses with them.
      const counted = readForEdit(reads.countUsages(analysisIds));
      // Cleared before the records go, so their removal is not reported back as stranding them.
      analysisIds.forEach(discardBreakdownDraft);
      runRowEdit(
        () => rowDispatch.deleteAnalyses(analysisIds),
        () => {
          setMergeNotice(undefined);
          announceCounted(counted, (usageCount) =>
            formatReplacementString(
              localizedStrings['%interlinearizer_analysisCatalog_deletedChecked%'],
              { count, usageCount },
            ),
          );
        },
      );
    },
    [announceCounted, discardBreakdownDraft, localizedStrings, reads, rowDispatch, runRowEdit],
  );

  const handleDeleteChecked = useCallback(() => {
    const analysisIds = [...checkedIds];
    requestDiscard(
      'delete',
      () => analysisIds,
      () => deleteChecked(analysisIds),
    );
  }, [checkedIds, deleteChecked, requestDiscard]);

  /**
   * Clears the glosses on `analysisIds` as one step, announcing how many of the records it removes,
   * `reclaimedIds`, it deleted for having nothing else and how many it merged into an identical
   * analysis. A clear that removes nothing goes unannounced, the cleared glosses showing in the
   * rows.
   */
  const clearGlossChecked = useCallback(
    (analysisIds: readonly string[], reclaimedIds: readonly string[]) => {
      const count = analysisIds.length;
      setMergeNotice(undefined);
      // Read before the clear, which deletes some of these records and their uses with them.
      const reclaimedRows = readForEdit(reads.rowsByIds(reclaimedIds));
      runRowEdit(
        () => rowDispatch.clearGlosses(analysisIds),
        (deletedIds) => {
          const deletedCount = deletedIds.length;
          const mergedCount = reclaimedIds.filter((id) => !deletedIds.includes(id)).length;
          if (deletedCount === 0 && mergedCount === 0) return;
          announceCounted(
            reclaimedRows.then(
              (reclaimed) => reclaimed && distinctUsageCount(reclaimed, new Set(deletedIds)),
            ),
            (usageCount) =>
              formatReplacementString(
                localizedStrings[clearedGlossKey(deletedCount, mergedCount)],
                { count, deletedCount, mergedCount, usageCount },
              ),
          );
        },
      );
    },
    [announceCounted, localizedStrings, reads, rowDispatch, runRowEdit],
  );

  const readGlossClearReclaims = useGlossClearReclaims();

  const handleClearGlossChecked = useMemo(() => {
    if (glossedCheckedIds.length === 0) return undefined;
    return () =>
      requestDropping(
        'clearGloss',
        () => readGlossClearReclaims(glossedCheckedIds),
        (reclaimedIds) => clearGlossChecked(glossedCheckedIds, reclaimedIds),
      );
  }, [glossedCheckedIds, clearGlossChecked, readGlossClearReclaims, requestDropping]);

  const handleMergeRequest = useCallback(
    (analysisId: string, mergedIds: readonly string[] = []) =>
      requestDiscard(
        'merge',
        () => [analysisId],
        () => setMergeRequest({ analysisId, mergedIds }),
      ),
    [requestDiscard],
  );

  /** Tells the reader where a merge left its tokens, offering to undo it, and shows that row. */
  const announceMerge = useCallback(
    (notice: MergeNotice) => {
      setMergeNotice(undefined);
      setRowToReveal({ analysisId: notice.survivingAnalysisId });
      announceUndoable(mergeNoticeMessage(notice, localizedStrings));
    },
    [announceUndoable, localizedStrings],
  );

  const commitMerge = useCallback(
    (
      survivorAnalysisId: string,
      mergedAnalysisIds: readonly string[],
      content: MergedContentDraft,
      surfaceText: string,
    ) => {
      // Every record the merge drops takes any draft typed against it, and so does a survivor a
      // converging merge folds into another record.
      [survivorAnalysisId, ...mergedAnalysisIds].forEach(discardBreakdownDraft);

      setMergeRequest(undefined);
      // Counted before the merge, which can remove every record it names.
      const counted = readForEdit(reads.countUsages([survivorAnalysisId, ...mergedAnalysisIds]));

      runRowEdit(
        () =>
          rowDispatch.mergeAll(survivorAnalysisId, mergedAnalysisIds, {
            gloss: content.gloss,
            glossFromAnalysisId: content.glossFromAnalysisId,
            morphemes: content.morphemes,
            morphemesStale: content.morphemesStale,
            pos: content.pos,
            features: content.features,
            confidence: content.confidence,
          }),
        // Reported against the record that the merge left standing, not the one it was aimed at.
        // The reader was warned that content matching an unmerged homograph moves the survivor.
        (outcome) => {
          if (outcome.kind === 'merged')
            announceMerge({
              survivingAnalysisId: outcome.survivingAnalysisId,
              survivingGloss: outcome.survivingGloss,
              surfaceText,
              usageCount: outcome.survivingUsageCount,
            });
          else if (outcome.kind === 'removed') {
            setMergeNotice(undefined);
            announceCounted(counted, (usageCount) =>
              formatReplacementString(
                localizedStrings['%interlinearizer_analysisCatalog_mergedEmpty%'],
                { form: surfaceText, count: usageCount },
              ),
            );
          } else
            afterCounting(counted, (usageCount) =>
              announceMerge({
                survivingAnalysisId: survivorAnalysisId,
                survivingGloss: content.gloss,
                surfaceText,
                usageCount,
              }),
            );
        },
      );
    },
    [
      announceCounted,
      announceMerge,
      discardBreakdownDraft,
      localizedStrings,
      reads,
      rowDispatch,
      runRowEdit,
    ],
  );

  /**
   * Commits the merge the panel settled, which names its own survivor and content, once any draft
   * on a record it would drop has been asked about.
   */
  const handleMergeConfirm = useCallback(
    (
      survivorAnalysisId: string,
      mergedAnalysisIds: readonly string[],
      content: MergedContentDraft,
      surfaceText: string,
    ) =>
      requestDiscard(
        'merge',
        () => [survivorAnalysisId, ...mergedAnalysisIds],
        () => commitMerge(survivorAnalysisId, mergedAnalysisIds, content, surfaceText),
      ),
    [commitMerge, requestDiscard],
  );

  const staleDispatch = useStaleLocationDispatch();
  const readStaleReclaims = useStaleLocationReclaims();

  const handleStaleDiscard = useCallback(
    (analysisId: string, location: CatalogUsage) =>
      requestDropping(
        'stale',
        () => readStaleReclaims.discard(analysisId, location.tokenRef),
        () => staleDispatch.discard(analysisId, location.tokenRef),
      ),
    [readStaleReclaims, requestDropping, staleDispatch],
  );

  const handleStaleReapply = useCallback(
    (analysisId: string, location: CatalogUsage, tokenRef: string, surfaceText: string) =>
      requestDropping(
        'stale',
        () => readStaleReclaims.reapply(analysisId, location.tokenRef, tokenRef, surfaceText),
        () => staleDispatch.reapply(analysisId, location.tokenRef, tokenRef, surfaceText),
      ),
    [readStaleReclaims, requestDropping, staleDispatch],
  );

  /** Every record of the form the open picker was opened on, most used first. */
  const homographRows = useHomographRows(mergeRequest?.analysisId, currentBook);

  /**
   * The analyses the open picker is choosing a merge's two ends between — every record of the form
   * the picker was opened on — or `undefined` once that form is down to a single record, which is
   * how a picker an edit beside the panel left with nothing to choose closes rather than
   * lingering.
   */
  const openMerge = useMemo(() => {
    const openedFrom = homographRows?.find((r) => r.analysisId === mergeRequest?.analysisId);
    if (!homographRows || !openedFrom) return undefined;
    return homographRows.length > 1
      ? { openedFrom, candidates: homographRows, mergedIds: mergeRequest?.mergedIds }
      : undefined;
  }, [homographRows, mergeRequest]);

  /**
   * Opens a merge of the checked rows into the most used of them, or `undefined` unless at least
   * two are checked and all of them are homographs. A merge only reassigns tokens within one form.
   */
  const mergeChecked = useMemo(() => {
    const merge = selection?.merge;
    if (!merge) return undefined;
    return () => handleMergeRequest(merge.survivorId, merge.mergedIds);
  }, [selection, handleMergeRequest]);

  return (
    // The panel sits beside the interlinear view rather than within it, so the row tooltips have no
    // enclosing provider to inherit, and a Tooltip without one throws. The delay is irrelevant here:
    // these tooltips open on truncation rather than on hover time.
    <TooltipProvider delayDuration={0}>
      <div
        ref={(el) => {
          panelRef.current = el ?? undefined;
        }}
        className="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:min-h-0 tw:border-s tw:border-border tw:bg-background"
        data-testid="analysis-catalog-panel"
      >
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:px-3 tw:py-2 tw:border-b tw:border-border">
          <SidePanelTabs
            active="catalog"
            localizedStrings={localizedStrings}
            onSelect={handleSwitchRequest}
          />
          <Button
            aria-label={localizedStrings['%interlinearizer_analysisCatalog_close%']}
            data-testid="analysis-catalog-close"
            onClick={handleCloseRequest}
            size="icon"
            variant="ghost"
          >
            <X className="tw:size-4" />
          </Button>
        </div>

        {/*
          Withheld from a draft that has recorded nothing, where every control would narrow an empty
          listing. Judged against the draft rather than against the rows a query left standing,
          which keeps the controls on screen for the query that matched nothing — they are the only
          way to widen it back.
        */}
        {rowCount > 0 && facets && (
          <CatalogQueryControls
            analysisLanguageName={analysisLanguageName}
            currentBookName={currentBookName}
            facets={facets}
            filters={filters}
            localizedStrings={localizedStrings}
            onFiltersChange={setFilters}
            onSearchChange={setSearch}
            onSortChange={setSort}
            search={search}
            showMorphology={showMorphology}
            sort={sort}
          />
        )}

        {mergeNotice && (
          <CatalogMergeNotice
            localizedStrings={localizedStrings}
            notice={mergeNotice}
            onDismiss={() => setMergeNotice(undefined)}
          />
        )}

        {!readOnly && rows.length > 0 && (
          <CatalogSelectionBar
            allChecked={checkedIds.size === rows.length}
            count={checkedIds.size}
            localizedStrings={localizedStrings}
            onCheckAll={setAllChecked}
            onClearGloss={handleClearGlossChecked}
            onMerge={mergeChecked}
            onDelete={handleDeleteChecked}
            usageCount={checkedUsageCount}
          />
        )}

        {strandedDraft && (
          <CatalogStrandedDraftNotice
            localizedStrings={localizedStrings}
            notice={strandedDraft}
            onDismiss={() => setStrandedDraft(undefined)}
          />
        )}

        {isAwaitingText && (
          <TextReadingStatus
            idPrefix="analysis-catalog-text"
            localizedStrings={localizedStrings}
            text={
              readStatus === 'error' || readStatus === undefined
                ? { status: readStatus ?? 'loading', booksRead: 0, bookCount: 0, failedBookIds: [] }
                : { status: 'loading', ...readStatus }
            }
          />
        )}

        {view &&
          !isAwaitingText &&
          (rows.length === 0 ? (
            // Two ways to have nothing to list, and they call for different answers: a draft that has
            // recorded nothing yet, and a query that kept none of what it did. Telling a reader the
            // draft is empty when they have merely mistyped would send them looking for lost work.
            <EmptyState
              className="tw:px-3 tw:py-2"
              id="analysis-catalog-empty"
              message={
                rowCount === 0
                  ? localizedStrings['%interlinearizer_analysisCatalog_empty%']
                  : localizedStrings['%interlinearizer_analysisCatalog_noMatches%']
              }
            />
          ) : (
            <CatalogList scrollRef={scrollRef} sentinelRef={sentinelRef}>
              {windowRows
                .flatMap(({ analysisId }) => sentRows.get(analysisId) ?? [])
                .map((row) => (
                  <CatalogRowView
                    key={row.analysisId}
                    analysisLanguage={analysisLanguage}
                    showMorphology={showMorphology}
                    breakdownDraft={breakdownDrafts.get(row.analysisId)?.text}
                    glossRetry={glossRetry}
                    isSelected={row.analysisId === selectedAnalysisId}
                    isChecked={checkedIds.has(row.analysisId)}
                    onCheckedChange={readOnly ? undefined : setChecked}
                    isNotInText={row.isNotInText}
                    liveSurfaceText={liveSurfaceText}
                    localizedStrings={localizedStrings}
                    onBreakdownDraftChange={handleBreakdownDraftChange}
                    // No discard prompt follows: the row's delete confirmation already covers the
                    // analysis's unsaved breakdown.
                    onDeleteRequest={deleteAnalysis}
                    onGlossCommit={handleGlossCommit}
                    onMergeRequest={row.hasHomograph ? handleMergeRequest : undefined}
                    onMorphemeGlossCommit={handleMorphemeGlossCommit}
                    onMorphemesCommit={handleMorphemesCommit}
                    onMorphemesConfirm={handleMorphemesConfirm}
                    onStaleDiscard={handleStaleDiscard}
                    onStaleReapply={handleStaleReapply}
                    onStaleSelect={handleStaleSelect}
                    onUsageSelect={handleUsageSelect}
                    row={row}
                    revealRequest={
                      row.analysisId === rowToReveal?.analysisId ? rowToReveal : undefined
                    }
                    usageCountInBookLabel={usageCountInBookLabel}
                  />
                ))}
            </CatalogList>
          ))}

        {/*
          Both modals are mounted against what they still have to act on rather than against the id
          alone, so a listing that turns over beneath one — an edit made in the view beside the
          panel — closes it instead of leaving it acting on a record that is no longer there. The
          merge panel stays mounted behind the draft ask it raises, holding the arrangement and the
          edits the reader made so that declining the ask returns to them.
        */}
        {openMerge && (
          <CatalogMergeModal
            analysisLanguage={analysisLanguage}
            showMorphology={showMorphology}
            candidates={openMerge.candidates}
            initialSurvivorId={openMerge.openedFrom.analysisId}
            localizedStrings={localizedStrings}
            initialMergedIds={openMerge.mergedIds}
            onCancel={() => setMergeRequest(undefined)}
            onConfirm={handleMergeConfirm}
            sourceLanguageTag={sourceLanguageTag}
            surfaceText={openMerge.openedFrom.surfaceText}
          />
        )}

        {/*
          Both asks are mounted on the draft still standing as well as on the ask itself, so saving
          or canceling it from the row beneath takes the question away rather than leaving the
          reader answering about work that is no longer unsaved.
        */}
        {confirmingLeave && hasUnsavedEdits && (
          <CatalogCloseModal
            action={confirmingLeave === 'switch' ? 'switch' : undefined}
            localizedStrings={localizedStrings}
            onCancel={() => setConfirmingLeave(undefined)}
            onConfirm={confirmingLeave === 'switch' ? onShowConcordance : onClose}
          />
        )}

        {discardGate.asking && rowHasUnsavedBreakdown(discardGate.asking.analysisId) && (
          <CatalogCloseModal
            action={discardGate.asking.action}
            localizedStrings={localizedStrings}
            onCancel={discardGate.cancel}
            onConfirm={discardGate.confirm}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
