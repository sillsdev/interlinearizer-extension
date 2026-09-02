import { useLocalizedStrings, useSetting } from '@papi/frontend/react';
import { Canon } from '@sillsdev/scripture';
import { X } from 'lucide-react';
import { Button, EmptyState, TooltipProvider } from 'platform-bible-react';
import { formatReplacementString, isPlatformError } from 'platform-bible-utils';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useAnalysisDeletionOutcome,
  useAnalysisLanguage,
  useAnalysisMergePeers,
  useAnalysisRowDispatch,
  useCatalogRows,
  useReportGlossEditing,
  type AnalysisEditOutcome,
} from './AnalysisStore';
import { breakdownDraftForms } from './CatalogRowEditor';
import CatalogCloseModal, { CLOSE_STRING_KEYS } from './CatalogCloseModal';
import CatalogDeleteModal, { DELETE_STRING_KEYS } from './CatalogDeleteModal';
import CatalogMergeModal, { MERGE_STRING_KEYS } from './CatalogMergeModal';
import CatalogMergeNotice, {
  CatalogStrandedDraftNotice,
  MERGE_NOTICE_STRING_KEYS,
  type MergeNotice,
  type StrandedDraftNotice,
} from './CatalogMergeNotice';
import CatalogQueryControls, { QUERY_CONTROL_STRING_KEYS } from './CatalogQueryControls';
import CatalogRowView, { ROW_STRING_KEYS } from './CatalogRowView';
import { useInterlinearNav } from './InterlinearNavContext';
import useRowWindow from '../hooks/useRowWindow';
import type { AnalysisDeletionOutcome } from '../store/analysisSlice';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import {
  applyCatalogQuery,
  deriveFacets,
  reconcileFilters,
  type CatalogFilters,
  type CatalogQuery,
  type CatalogSort,
  type CatalogUsage,
} from '../utils/analysis-query';
import { collatorForTag, languageNameForTag } from '../utils/language-tags';

/**
 * Localized string keys the panel needs, the rows' among them so the list resolves once rather than
 * once per analysis. Hoisted to module scope so the reference passed to `useLocalizedStrings` is
 * stable across renders; a fresh array literal each render makes the PAPI hook re-fetch and re-set
 * state every render.
 */
const STRING_KEYS = [
  '%interlinearizer_analysisCatalog_title%',
  '%interlinearizer_analysisCatalog_close%',
  '%interlinearizer_analysisCatalog_resize%',
  '%interlinearizer_analysisCatalog_empty%',
  '%interlinearizer_analysisCatalog_usageCountInBook%',
  '%interlinearizer_analysisCatalog_noMatches%',
  ...QUERY_CONTROL_STRING_KEYS,
  ...ROW_STRING_KEYS,
  ...MERGE_NOTICE_STRING_KEYS,
  ...MERGE_STRING_KEYS,
  ...DELETE_STRING_KEYS,
  ...CLOSE_STRING_KEYS,
] as const satisfies `%${string}%`[];

/** A breakdown a row is holding, with the form it was typed against. */
type BreakdownDraft = Readonly<{
  /** The breakdown as a line of space-separated forms. */
  text: string;
  /** The analysis's surface form when the draft was opened, which names it once the record is gone. */
  surfaceText: string;
}>;

/** Props for {@link AnalysisCatalogPanel}. */
type AnalysisCatalogPanelProps = Readonly<{
  /** Dismisses the panel. */
  onClose: () => void;
  /** Book code each row's per-book usage count is taken against. */
  currentBook: string;
  /** Whether this project breaks words into morphemes, which the breakdown filter is offered for. */
  showMorphology: boolean;
  /** BCP 47 tag of the source text, so surface forms collate by their own language. */
  sourceLanguageTag: string;
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
  onClose,
  currentBook,
  showMorphology,
  sourceLanguageTag,
}: AnalysisCatalogPanelProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const analysisLanguage = useAnalysisLanguage();
  const catalogRows = useCatalogRows(currentBook);

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

  // Each rebuilt only when its own tag changes: the query around them turns over on every keystroke
  // in the search box, and a collator is expensive enough to be worth not rebuilding that often.
  const surfaceCollator = useMemo(() => collatorForTag(sourceLanguageTag), [sourceLanguageTag]);
  const glossCollator = useMemo(() => collatorForTag(analysisLanguage), [analysisLanguage]);

  /**
   * The choices worth offering as filters, taken against every row the draft holds rather than the
   * rows a filter left standing: a facet judged against its own selection's survivors would
   * collapse to that selection, leaving no choice on screen to widen it back by.
   */
  const facets = useMemo(() => deriveFacets(catalogRows), [catalogRows]);

  /**
   * The filters actually narrowing the listing: the reader's choices less any the facets have since
   * withdrawn. An edit beside the panel can remove the last row carrying a chosen value, which
   * takes that facet's control off screen; keeping the choice would narrow the list to nothing with
   * no control left to widen it back by.
   */
  const filters = useMemo(() => reconcileFilters(chosenFilters, facets), [chosenFilters, facets]);

  /**
   * Commits a withdrawal back over the choices it narrowed, so a value the facets dropped is spent
   * rather than merely unused. Left recorded it would return with its facet, narrowing the listing
   * by a filter the reader had watched release.
   *
   * Settles after one withdrawal, {@link reconcileFilters} yielding the very set it was given once
   * every choice survives.
   */
  useEffect(() => {
    if (filters !== chosenFilters) setFilters(filters);
  }, [filters, chosenFilters]);

  /** How the listing is narrowed and ordered, from the controls above the list. */
  const query = useMemo<CatalogQuery>(
    () => ({ search, sort, filters, surfaceCollator, glossCollator }),
    [search, sort, filters, surfaceCollator, glossCollator],
  );

  const rows = useMemo(() => applyCatalogQuery(catalogRows, query), [catalogRows, query]);

  /**
   * The current book's name key, asked for separately from {@link STRING_KEYS} so that changing book
   * re-resolves this alone rather than every string the panel shows.
   */
  const bookNameKeys = useMemo(
    () => [`%LocalizedId.${currentBook}%`] as const satisfies `%${string}%`[],
    [currentBook],
  );
  const [localizedBookName] = useLocalizedStrings(bookNameKeys);

  /**
   * What the current book is called wherever the panel names it in prose. Resolved once and given
   * to every view that names it, so the sort option and the row column cannot name one book two
   * ways.
   *
   * Falls back to the English name, the platform carrying a localized one for only some languages.
   * An unresolved key comes back as itself, which is what distinguishes the two.
   */
  const currentBookName = useMemo(() => {
    const [bookKey] = bookNameKeys;
    const resolved = localizedBookName?.[bookKey];
    return resolved && resolved !== bookKey ? resolved : Canon.bookIdToEnglishName(currentBook);
  }, [localizedBookName, bookNameKeys, currentBook]);

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
   * Everything that decides which listing is on screen. The book counts alongside the query because
   * each row's per-book usage is taken against it: moving to another book reorders a listing sorted
   * by that count, and relabels that column in every other.
   */
  const listing = useMemo(() => ({ query, currentBook }), [query, currentBook]);

  /**
   * What the last edit's collapse left standing, or `undefined` when no edit has collapsed one.
   * Kept until dismissed or superseded: the reader may be looking anywhere in the list when an edit
   * commits, and a row that vanishes unexplained reads as data loss.
   */
  const [mergeNotice, setMergeNotice] = useState<MergeNotice | undefined>(undefined);

  /**
   * Where the row a merge notice names sits in the listing, or `undefined` when no notice stands. A
   * collapse can leave the survivor anywhere — an unused record inherits no usages to carry it up a
   * listing ordered by them — so it is not otherwise guaranteed to be within the mounted window.
   */
  const noticedRowIndex = useMemo(() => {
    if (!mergeNotice) return undefined;
    const index = rows.findIndex((r) => r.analysisId === mergeNotice.survivingAnalysisId);
    return index === -1 ? undefined : index;
  }, [rows, mergeNotice]);

  /**
   * The slice of the listing that is actually mounted. A draft accumulates analyses without bound
   * and every row carries its own expander and usage list, so the list grows as it is scrolled
   * rather than rendering whole.
   */
  const { windowRows, scrollRef, sentinelRef } = useRowWindow(rows, listing, noticedRowIndex);

  const { navigate, requestFocusToken } = useInterlinearNav();

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

  const rowDispatch = useAnalysisRowDispatch();
  const readDeletionOutcome = useAnalysisDeletionOutcome();

  /**
   * The row whose merge picker or delete confirmation is open, or `undefined` when neither is. Held
   * as an id rather than as a row, so a listing that turns over beneath an open modal cannot leave
   * it holding a stale copy of what it is about to act on.
   */
  const [mergeSourceId, setMergeSourceId] = useState<string | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | undefined>(undefined);

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
   * Whether one row is holding a breakdown the reader has changed but not saved.
   *
   * Compared as forms rather than as text, so the whole word the editor pre-fills for an
   * unsegmented breakdown is not unsaved work.
   */
  const rowHasUnsavedBreakdown = useCallback(
    (analysisId: string) => {
      const row = catalogRows.find((r) => r.analysisId === analysisId);
      const draft = row && breakdownDrafts.get(analysisId);
      if (row === undefined || draft === undefined) return false;
      return (
        breakdownDraftForms(draft.text, row.surfaceText).join(' ') !==
        row.morphemes.map((m) => m.form).join(' ')
      );
    },
    [catalogRows, breakdownDrafts],
  );

  /** Whether any row is holding a breakdown the reader has changed but not saved. */
  const hasUnsavedBreakdown = useMemo(
    () => catalogRows.some((r) => rowHasUnsavedBreakdown(r.analysisId)),
    [catalogRows, rowHasUnsavedBreakdown],
  );

  useReportGlossEditing(hasUnsavedBreakdown);

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
    const stranded = [...breakdownDrafts].find(
      ([analysisId]) => !catalogRows.some((r) => r.analysisId === analysisId),
    );
    if (!stranded) return;
    const [analysisId, draft] = stranded;
    setStrandedDraft({ surfaceText: draft.surfaceText });
    discardBreakdownDraft(analysisId);
  }, [breakdownDrafts, catalogRows, discardBreakdownDraft]);

  /** Whether the reader is being asked to confirm closing over a breakdown they have not saved. */
  const [confirmingClose, setConfirmingClose] = useState(false);

  /**
   * Closes the panel, or asks first when a breakdown draft would go with it.
   *
   * A breakdown commits on neither blur nor unmount, so closing is the one route that can drop
   * typed text the reader never asked to discard.
   */
  const handleCloseRequest = useCallback(() => {
    if (hasUnsavedBreakdown) setConfirmingClose(true);
    else onClose();
  }, [hasUnsavedBreakdown, onClose]);

  /**
   * Records what an edit did, so a collapse is reported rather than left to look like a vanished
   * row. An ordinary edit clears whatever the last one said, the notice naming the edit just made
   * rather than an older one.
   */
  const reportEditOutcome = useCallback((outcome: AnalysisEditOutcome, surfaceText: string) => {
    setMergeNotice(
      outcome.kind === 'merged'
        ? {
            survivingAnalysisId: outcome.survivingAnalysisId,
            survivingGloss: outcome.survivingGloss,
            surfaceText,
            usageCount: outcome.survivingUsageCount,
          }
        : undefined,
    );
  }, []);

  /**
   * The surface form of the row an edit came from, for a merge notice to name the survivor by when
   * it carries no gloss. The two share a form — a collapse only ever happens between homographs —
   * so the edited row's own is the survivor's too.
   */
  const surfaceTextOf = useCallback(
    (analysisId: string) =>
      /* v8 ignore next -- the id came from a row of this very listing, so it always resolves */
      catalogRows.find((r) => r.analysisId === analysisId)?.surfaceText ?? '',
    [catalogRows],
  );

  const handleGlossCommit = useCallback(
    (analysisId: string, value: string) => {
      reportEditOutcome(rowDispatch.writeGloss(analysisId, value), surfaceTextOf(analysisId));
    },
    [reportEditOutcome, rowDispatch, surfaceTextOf],
  );

  const handleMorphemesCommit = useCallback(
    (analysisId: string, forms: readonly string[]) => {
      reportEditOutcome(
        rowDispatch.writeMorphemes(analysisId, forms, sourceLanguageTag),
        surfaceTextOf(analysisId),
      );
    },
    [reportEditOutcome, rowDispatch, sourceLanguageTag, surfaceTextOf],
  );

  const handleMorphemeGlossCommit = useCallback(
    (analysisId: string, morphemeId: string, value: string) => {
      reportEditOutcome(
        rowDispatch.writeMorphemeGloss(analysisId, morphemeId, value),
        surfaceTextOf(analysisId),
      );
    },
    [reportEditOutcome, rowDispatch, surfaceTextOf],
  );

  /**
   * The outcome the open confirmation is stating, read once as it opens rather than subscribed:
   * quoting a fallback that changed under the reader mid-decision would be worse than quoting the
   * one they opened on.
   */
  const [deletionOutcome, setDeletionOutcome] = useState<AnalysisDeletionOutcome | undefined>(
    undefined,
  );

  /**
   * The edit a row is waiting to make once the reader agrees to lose the breakdown they typed
   * against it, or `undefined` when none is waiting.
   *
   * Merging and deleting both drop the record a draft is keyed to, which takes the draft with it —
   * so like closing, they ask first.
   */
  const [discardingFor, setDiscardingFor] = useState<
    { kind: 'merge' | 'delete'; analysisId: string } | undefined
  >(undefined);

  const openDelete = useCallback(
    (analysisId: string) => {
      const outcome = readDeletionOutcome(analysisId);
      // No outcome means the record is already gone, so there is nothing left to confirm deleting.
      /* v8 ignore next -- the id came from a row of this very listing, so it always resolves */
      if (!outcome) return;
      setDeletionOutcome(outcome);
      setDeletingId(analysisId);
    },
    [readDeletionOutcome],
  );

  const handleDeleteRequest = useCallback(
    (analysisId: string) => {
      if (rowHasUnsavedBreakdown(analysisId)) setDiscardingFor({ kind: 'delete', analysisId });
      else openDelete(analysisId);
    },
    [openDelete, rowHasUnsavedBreakdown],
  );

  const handleMergeRequest = useCallback(
    (analysisId: string) => {
      if (rowHasUnsavedBreakdown(analysisId)) setDiscardingFor({ kind: 'merge', analysisId });
      else setMergeSourceId(analysisId);
    },
    [rowHasUnsavedBreakdown],
  );

  /** Gives up the draft, leaving the edit itself still to be confirmed. */
  const handleDiscardConfirm = useCallback(() => {
    /* v8 ignore next -- unreachable: the modal that calls this mounts only on a set ask */
    if (!discardingFor) return;
    const { kind, analysisId } = discardingFor;
    discardBreakdownDraft(analysisId);
    setDiscardingFor(undefined);
    if (kind === 'delete') openDelete(analysisId);
    else setMergeSourceId(analysisId);
  }, [discardingFor, discardBreakdownDraft, openDelete]);

  const handleDeleteConfirm = useCallback(() => {
    if (deletingId) {
      // Cleared before the record goes, so this removal is not reported back to the reader who
      // asked for it.
      discardBreakdownDraft(deletingId);
      rowDispatch.deleteAnalysis(deletingId);
    }
    setDeletingId(undefined);
    // A deleted row cannot be the one a merge notice points at, and leaving the notice up would
    // send the reader to a row that is no longer there.
    setMergeNotice(undefined);
  }, [deletingId, discardBreakdownDraft, rowDispatch]);

  const handleMergeConfirm = useCallback(
    (targetAnalysisId: string) => {
      if (mergeSourceId) {
        discardBreakdownDraft(mergeSourceId);
        rowDispatch.mergeInto(mergeSourceId, targetAnalysisId);
      }
      setMergeSourceId(undefined);
    },
    [discardBreakdownDraft, mergeSourceId, rowDispatch],
  );

  const mergeSourceRow = useMemo(
    () => catalogRows.find((row) => row.analysisId === mergeSourceId),
    [catalogRows, mergeSourceId],
  );
  const deletingRow = useMemo(
    () => catalogRows.find((row) => row.analysisId === deletingId),
    [catalogRows, deletingId],
  );

  const mergePeers = useAnalysisMergePeers(mergeSourceId ?? '');

  /**
   * How many tokens approve each analysis, so the merge picker can rank its choices. Taken off the
   * rows the panel already holds rather than derived again, the catalog's usage count being that
   * same number.
   */
  const usageCountByAnalysisId = useMemo(
    () => new Map(catalogRows.map((row) => [row.analysisId, row.usageCount])),
    [catalogRows],
  );

  /**
   * Which rows have a peer to merge into, so each row's merge control is offered only where it
   * leads somewhere. Derived once for the listing rather than subscribed per row, which would be a
   * pool lookup per analysis in the draft on every store change.
   *
   * Bucketed by the same normalized form the pool buckets by, so a row offered the control always
   * finds peers in the picker: grouping by the raw text instead would withhold it from homographs
   * differing only in case or Unicode form, which are peers as far as the store is concerned.
   */
  const idsWithMergePeers = useMemo(() => {
    const byForm = new Map<string, string[]>();
    catalogRows.forEach((row) => {
      const key = normalizeSurfaceForm(row.surfaceText);
      const bucket = byForm.get(key) ?? [];
      bucket.push(row.analysisId);
      byForm.set(key, bucket);
    });
    return new Set([...byForm.values()].filter((bucket) => bucket.length > 1).flat());
  }, [catalogRows]);

  return (
    // The panel sits beside the interlinear view rather than within it, so the row tooltips have no
    // enclosing provider to inherit, and a Tooltip without one throws. The delay is irrelevant here:
    // these tooltips open on truncation rather than on hover time.
    <TooltipProvider delayDuration={0}>
      <div
        className="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:min-h-0 tw:border-s tw:border-border tw:bg-background"
        data-testid="analysis-catalog-panel"
      >
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:px-3 tw:py-2 tw:border-b tw:border-border">
          <h2 className="tw:text-sm tw:font-semibold">
            {localizedStrings['%interlinearizer_analysisCatalog_title%']}
          </h2>
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
        {catalogRows.length > 0 && (
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

        {strandedDraft && (
          <CatalogStrandedDraftNotice
            localizedStrings={localizedStrings}
            notice={strandedDraft}
            onDismiss={() => setStrandedDraft(undefined)}
          />
        )}

        {rows.length === 0 ? (
          // Two ways to have nothing to list, and they call for different answers: a draft that has
          // recorded nothing yet, and a query that kept none of what it did. Telling a reader the
          // draft is empty when they have merely mistyped would send them looking for lost work.
          <EmptyState
            className="tw:px-3 tw:py-2"
            id="analysis-catalog-empty"
            message={
              catalogRows.length === 0
                ? localizedStrings['%interlinearizer_analysisCatalog_empty%']
                : localizedStrings['%interlinearizer_analysisCatalog_noMatches%']
            }
          />
        ) : (
          <ul
            className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-y-auto"
            ref={scrollRef}
          >
            {windowRows.map((row) => (
              <CatalogRowView
                key={row.analysisId}
                analysisLanguage={analysisLanguage}
                breakdownDraft={breakdownDrafts.get(row.analysisId)?.text}
                isSelected={row.analysisId === selectedAnalysisId}
                localizedStrings={localizedStrings}
                onBreakdownDraftChange={handleBreakdownDraftChange}
                onDeleteRequest={handleDeleteRequest}
                onGlossCommit={handleGlossCommit}
                onMergeRequest={
                  idsWithMergePeers.has(row.analysisId) ? handleMergeRequest : undefined
                }
                onMorphemeGlossCommit={handleMorphemeGlossCommit}
                onMorphemesCommit={handleMorphemesCommit}
                onUsageSelect={handleUsageSelect}
                row={row}
                shouldRevealSelf={row.analysisId === mergeNotice?.survivingAnalysisId}
                usageCountInBookLabel={usageCountInBookLabel}
              />
            ))}
            {/*
              Sits after the last mounted row, so reaching it means the reader has scrolled to the
              end of what is mounted rather than to the end of the listing. A list item rather than a
              bare div, since a `ul` may hold nothing else.
            */}
            <li aria-hidden data-testid="catalog-rows-sentinel" ref={sentinelRef} />
          </ul>
        )}

        {/*
          Both modals are mounted against the row they were opened on rather than against the id
          alone, so a listing that turns over beneath one — an edit made in the view beside the
          panel — closes it instead of leaving it acting on a record that is no longer there.
        */}
        {mergeSourceRow && (
          <CatalogMergeModal
            analysisLanguage={analysisLanguage}
            localizedStrings={localizedStrings}
            onCancel={() => setMergeSourceId(undefined)}
            onConfirm={handleMergeConfirm}
            peers={mergePeers}
            surfaceText={mergeSourceRow.surfaceText}
            usageCountByAnalysisId={usageCountByAnalysisId}
          />
        )}

        {deletingRow && deletionOutcome && (
          <CatalogDeleteModal
            localizedStrings={localizedStrings}
            onCancel={() => setDeletingId(undefined)}
            onConfirm={handleDeleteConfirm}
            outcome={deletionOutcome}
            surfaceText={deletingRow.surfaceText}
          />
        )}

        {/*
          Both asks are mounted on the draft still standing as well as on the ask itself, so saving
          or canceling it from the row beneath takes the question away rather than leaving the
          reader answering about work that is no longer unsaved.
        */}
        {confirmingClose && hasUnsavedBreakdown && (
          <CatalogCloseModal
            localizedStrings={localizedStrings}
            onCancel={() => setConfirmingClose(false)}
            onConfirm={onClose}
          />
        )}

        {discardingFor && rowHasUnsavedBreakdown(discardingFor.analysisId) && (
          <CatalogCloseModal
            action={discardingFor.kind}
            localizedStrings={localizedStrings}
            onCancel={() => setDiscardingFor(undefined)}
            onConfirm={handleDiscardConfirm}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
