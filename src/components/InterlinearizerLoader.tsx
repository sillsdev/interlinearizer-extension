import type {
  UseWebViewScrollGroupScrRefHook,
  UseWebViewStateHook,
  WebViewProps,
} from '@papi/core';
import papi, { logger } from '@papi/frontend';
import { useData, useLocalizedStrings, useSetting } from '@papi/frontend/react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  TabToolbar,
} from 'platform-bible-react';
import type { SelectMenuItemHandler } from 'platform-bible-react';
import { isPlatformError } from 'platform-bible-utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactNode, RefObject } from 'react';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import useDraftProject from '../hooks/useDraftProject';
import useInterlinearizerBookData from '../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../hooks/useOptimisticBooleanSetting';
import {
  isDefaultSegmentation,
  mergeSegments,
  moveBoundary,
  splitSegmentBefore,
} from '../utils/segmentation';
import { isWordToken } from '../types/type-guards';
import type { SegmentationDispatch } from './SegmentationStore';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';
import Interlinearizer from './Interlinearizer';
import { AnalysisStoreProvider } from './AnalysisStore';
import AnalysisCatalogPanel from './AnalysisCatalogPanel';
import ViewOptionsDropdown from './controls/ViewOptionsDropdown';
import type { PhraseMode } from '../types/phrase-mode';
import ProjectModals, { type ModalState } from './modals/ProjectModals';
import { WipeModal, type WipeScope } from './modals/WipeModal';
import ScriptureNavControls from './controls/ScriptureNavControls';
import { InterlinearNavProvider, useInterlinearNav, type FadePhase } from './InterlinearNavContext';
import { RECENTER_FADE_TRANSITION_STYLE } from './recenter-fade';
import { firstVerseNumber, segmentContainsVerse } from '../utils/verse-ref';
import { resolvedOrEmpty } from '../utils/localized-strings';
import usePanelResizeKeys from '../hooks/usePanelResizeKeys';

/** Host-injected callback to update this WebView's definition (used to toggle the tab title). */
type UpdateWebViewDefinition = WebViewProps['updateWebViewDefinition'];

/**
 * WebView menu holding only the platform defaults. Used both as the `useData` default while the
 * provider's menu is loading and as the fallback when it returns an error.
 */
const DEFAULT_WEB_VIEW_MENU = {
  topMenu: undefined,
  includeDefaults: true,
  contextMenu: undefined,
};

/**
 * Base tab title for the Interlinearizer WebView. PAPI exposes no native unsaved-changes indicator,
 * so {@link UNSAVED_TAB_MARKER} is appended to this while the draft has unsaved changes.
 */
const BASE_TAB_TITLE = 'Interlinearizer';

/** Props for {@link BookFadeWrapper}. */
type BookFadeWrapperProps = Readonly<{
  /** How far through a cross-book fade the view is. */
  fadePhase: FadePhase;
  /** The interlinear view, or the placeholder standing in for it. */
  children: ReactNode;
}>;

/**
 * The cross-book curtain: the column holding whatever the view is showing of the book, dimmed while
 * a jump to another book is in flight.
 *
 * @returns An element carrying `data-testid="book-fade-wrapper"`.
 */
function BookFadeWrapper({ fadePhase, children }: BookFadeWrapperProps) {
  return (
    <div
      data-testid="book-fade-wrapper"
      className="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:min-h-0 tw:transition-opacity"
      // The fade-out must hide content instantly (zero-duration), not transition to 0: the old book
      // is swapped for the Loading… placeholder in the same commit the curtain drops, so a gradual
      // descent would only let a fast-loading new book ghost in at partial opacity, then dim and
      // rise again. The rise (`in` → `idle`) keeps the shared recenter timing.
      style={{
        opacity: fadePhase === 'out' ? 0 : 1,
        ...RECENTER_FADE_TRANSITION_STYLE,
        ...(fadePhase === 'out' ? { transitionDuration: '0ms' } : undefined),
      }}
    >
      {children}
    </div>
  );
}

/** Glyph appended to the tab title while the draft has unsaved changes. */
const UNSAVED_TAB_MARKER = ' ●';

/** Identifies the interlinear view within the catalog group, in a {@link PanelLayout} and the DOM. */
const VIEW_PANEL_ID = 'interlinearView';

/** Identifies the catalog within its group, in a {@link PanelLayout} and the DOM. */
const CATALOG_PANEL_ID = 'analysisCatalog';

/**
 * How much of the container the interlinear view keeps whatever the catalog is resized to. The
 * panel sits beside the text rather than over it, so a container too narrow for both narrows the
 * catalog rather than pushing the text off the screen.
 */
const MIN_VIEW_WIDTH = '240px';

/** Narrowest the catalog may be resized to, below which its usage counts stop fitting. */
const MIN_CATALOG_WIDTH = '220px';

/** Widest the catalog may be resized to, past which no gloss needs the room. */
const MAX_CATALOG_WIDTH = '800px';

/**
 * A resizable group's layout: the percentage of the group each of its panels holds, by panel id.
 * Percentages rather than fractions because a group rescales any layout it is handed to sum to 100,
 * so that is the unit one comes back in.
 */
type PanelLayout = Readonly<Record<string, number>>;

/** Holds the handle a resizable group exposes for moving its panels after it has mounted. */
type GroupHandleRef = Extract<
  ComponentProps<typeof ResizablePanelGroup>['groupRef'],
  RefObject<unknown>
>;

/**
 * How the catalog group is laid out before the user has ever resized it: enough of the container
 * for a gloss to be read beside the text without crowding it.
 */
const DEFAULT_CATALOG_LAYOUT: PanelLayout = { [VIEW_PANEL_ID]: 75, [CATALOG_PANEL_ID]: 25 };

/**
 * How much of the group Home and End aim the catalog at. What it settles on is whatever
 * {@link MIN_CATALOG_WIDTH} and {@link MAX_CATALOG_WIDTH} allow, those being the real limits.
 */
const CATALOG_PERCENTAGE_BOUNDS = { min: 15, max: 50 };

/**
 * Localized string keys the load/error placeholder needs. Hoisted to module scope so the reference
 * passed to `useLocalizedStrings` is stable across renders; a fresh array literal each render makes
 * the PAPI hook re-fetch and re-set state every render.
 */
const STRING_KEYS = [
  '%interlinearizer_error_load_book_heading%',
  '%interlinearizer_error_process_book_heading%',
  '%interlinearizer_loading%',
  '%interlinearizer_analysisCatalog_resize%',
] as const satisfies `%${string}%`[];

/**
 * Root component for the Interlinearizer WebView. Mounts the {@link InterlinearNavProvider} so the
 * loader and the whole {@link Interlinearizer} subtree read and write navigation through one source
 * of truth; the loading and rendering happen inside that provider.
 */
export default function InterlinearizerLoader({
  projectId,
  useWebViewScrollGroupScrRef,
  useWebViewState,
  updateWebViewDefinition,
}: Readonly<{
  /** PAPI project ID passed from the host. */
  projectId: string;
  /** Host-injected hook exposing the shared scroll-group scripture reference and its setter. */
  useWebViewScrollGroupScrRef: UseWebViewScrollGroupScrRefHook;
  /** Host-injected hook for reading and writing typed WebView-scoped state. */
  useWebViewState: UseWebViewStateHook;
  /** Used to toggle the tab's unsaved-changes title marker. */
  updateWebViewDefinition: UpdateWebViewDefinition;
}>) {
  return (
    <InterlinearNavProvider useWebViewScrollGroupScrRef={useWebViewScrollGroupScrRef}>
      <InterlinearizerLoaderInner
        projectId={projectId}
        useWebViewState={useWebViewState}
        updateWebViewDefinition={updateWebViewDefinition}
      />
    </InterlinearNavProvider>
  );
}

/**
 * Loads book data and settings, manages modal state for project creation/selection/metadata, then
 * renders error and loading states or delegates to {@link Interlinearizer} when data is ready. Reads
 * the scripture reference and scroll-group linkage from {@link useInterlinearNav} rather than
 * calling the host hook directly.
 */
function InterlinearizerLoaderInner({
  projectId,
  useWebViewState,
  updateWebViewDefinition,
}: Readonly<{
  /** PAPI project ID passed from the host. */
  projectId: string;
  /** Host-injected hook for reading and writing typed WebView-scoped state. */
  useWebViewState: UseWebViewStateHook;
  /** Used to toggle the tab's unsaved-changes title marker. */
  updateWebViewDefinition: UpdateWebViewDefinition;
}>) {
  const { scrRef, navigate, scrollGroupId, setScrollGroupId, fadePhase, cancelFade } =
    useInterlinearNav();
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);

  const [interfaceMode] = useSetting('platform.interfaceMode', 'simple');
  const [interfaceLanguages] = useSetting('platform.interfaceLanguage', ['und']);
  /* v8 ignore next 3 -- useSetting never returns PlatformError for this key in practice */
  const platformLanguage = isPlatformError(interfaceLanguages)
    ? 'und'
    : interfaceLanguages[0] || 'und';

  /**
   * Persisted snapshot of the active interlinear project — kept in WebView state so it survives tab
   * restores. The project modals write the same `'activeProject'` key as projects are opened,
   * created, or edited. Read here to gate the project-specific menu items and to route Save to the
   * active project (Save As when none); written here to fold the refreshed `updatedAt` from a
   * successful save back into the snapshot.
   */
  const [activeProject, setActiveProject] = useWebViewState<InterlinearProjectSummary | undefined>(
    'activeProject',
    undefined,
  );

  // The always-present draft is the runtime source of truth for the analysis being edited. Edits
  // auto-save here (not to the active project); Save / Save As copy the draft into a project.
  const {
    isDraftLoading,
    draft,
    draftVersion,
    segmentationVersion,
    dirty,
    autosaveAnalysis,
    autosaveSegmentation,
    loadFromProject,
    newDraft,
    getDraftSnapshot,
    markSynced,
    wipeBook,
    wipeAll,
  } = useDraftProject(projectId, platformLanguage);

  /**
   * BCP 47 tag used for reading and writing gloss values. Prefers the draft's first configured
   * analysis language; falls back to the platform UI language for a brand-new source.
   */
  const analysisLanguage = draft?.analysisLanguages[0] ?? platformLanguage;

  // Whether any gloss input currently holds uncommitted text. Gloss writes are deferred to blur, so
  // the persisted `dirty` flag does not flip until then; tracking in-progress edits here lets the
  // unsaved indicator light up the moment the user starts typing.
  const [pendingEdits, setPendingEdits] = useState(false);

  // Reflect the draft's unsaved-changes state in the tab title, since PAPI has no native dirty
  // indicator. The marker shows for both committed changes (`dirty`) and in-progress typing
  // (`pendingEdits`).
  const hasUnsavedChanges = dirty || pendingEdits;
  useEffect(() => {
    updateWebViewDefinition({
      title: hasUnsavedChanges ? `${BASE_TAB_TITLE}${UNSAVED_TAB_MARKER}` : BASE_TAB_TITLE,
    });
  }, [hasUnsavedChanges, updateWebViewDefinition]);

  const {
    isLoading: isContinuousScrollLoading,
    onChange: handleContinuousScrollChange,
    value: continuousScroll,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.continuousScroll', true);

  const {
    isLoading: isHideInactiveLinkButtonsLoading,
    onChange: handleHideInactiveLinkButtonsChange,
    value: hideInactiveLinkButtons,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.hideInactiveLinkButtons', false);

  const {
    isLoading: isSimplifyPhrasesLoading,
    onChange: handleSimplifyPhrasesChange,
    value: simplifyPhrases,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.simplifyPhrases', false);

  const {
    isLoading: isShowMorphologyLoading,
    onChange: handleShowMorphologyChange,
    value: showMorphology,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.showMorphology', false);

  const {
    isLoading: isShowFreeTranslationLoading,
    onChange: handleShowFreeTranslationChange,
    value: showFreeTranslation,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.showFreeTranslation', false);

  const {
    isLoading: isShowVerseGutterLoading,
    onChange: handleShowVerseGutterChange,
    value: showVerseGutter,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.showVerseGutter', false);

  // Removable demo toggle (not persisted) for the open "suggestion display prominence" UX question
  // (see `user-questions.md`): while on, un-approved tokens matching the pool render the engine's
  // blue suggestion with accept / promote affordances. Defaults on (suggestions are always-on by
  // design); flip it off to A/B the "screen fills with suggestions" concern against a clean view.
  // Remove this state and its dropdown row once the UX is decided.
  const [showSuggestions, setShowSuggestions] = useState(true);

  // Bundle the display toggles into one stable object. Memoizing on the primitive values keeps the
  // reference identical across the loader's frequent re-renders, so the `memo()` wrapping
  // `SegmentView` can shallow-compare it away when no toggle actually changed.
  const viewOptions = useMemo(
    () => ({
      hideInactiveLinkButtons,
      simplifyPhrases,
      showMorphology,
      showFreeTranslation,
      showVerseGutter,
    }),
    [
      hideInactiveLinkButtons,
      simplifyPhrases,
      showMorphology,
      showFreeTranslation,
      showVerseGutter,
    ],
  );

  const {
    book: verseBook,
    isLoading,
    bookError,
    tokenizeError,
    writingSystem,
  } = useInterlinearizerBookData({
    projectId,
    scrRef,
  });

  /**
   * The book the views render: the verse-tokenized book re-grouped into the user's custom segments.
   * Identical (by reference) to `verseBook` when no custom boundaries are set, so the common case
   * incurs no extra work. `verseBook` is retained separately because the segmentation operations
   * need the default verse boundaries it carries.
   *
   * `draft.segmentation` is read fresh from the ref-held draft at recompute time; the deps are the
   * two version counters that cover every path that can change it — `segmentationVersion` for
   * boundary edits, `draftVersion` for wholesale replacements (New / Open / Wipe). The draft object
   * itself is deliberately NOT a dep: gloss auto-saves replace its identity on every write without
   * touching the boundaries, so keying on it would re-run the full re-segmentation after every
   * gloss edit. `isDraftLoading` covers the one replacement that bumps neither counter: the initial
   * draft load.
   */
  const book = useMemo(
    () => (verseBook ? resegmentBook(verseBook, draft?.segmentation) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the version counters track draft?.segmentation, a ref value
    [verseBook, segmentationVersion, draftVersion, isDraftLoading],
  );

  /**
   * Maps each merged-away default verse boundary's word-token split anchor — the verse's first word
   * token, the ref the boundary slots are keyed by — to the removed default start ref (the verse's
   * first token of any type, per the delta's `removedVerseStarts`). The two differ when a verse
   * begins with punctuation (e.g. an opening quote); mapping through the word anchor lets the slot
   * render the former-boundary tick and dispatch a split that cancels the removal exactly. Deps
   * mirror the `book` memo above.
   */
  const formerBoundaries = useMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    const removed = draft?.segmentation?.removedVerseStarts ?? [];
    if (removed.length === 0 || !verseBook) return map;
    const removedSet = new Set(removed);
    verseBook.segments.forEach((verse) => {
      const startRef = verse.tokens[0]?.ref;
      if (startRef === undefined || !removedSet.has(startRef)) return;
      const wordAnchorRef = verse.tokens.find(isWordToken)?.ref;
      if (wordAnchorRef !== undefined) map.set(wordAnchorRef, startRef);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the version counters track draft?.segmentation, a ref value
  }, [verseBook, segmentationVersion, draftVersion, isDraftLoading]);

  /**
   * Boundary-editing operations exposed through the segmentation context. Each reads the draft's
   * latest boundary delta synchronously (so rapid edits compose correctly), applies the relevant
   * pure transform against the original verse book, and auto-saves the normalized result — clearing
   * the field back to `undefined` when the edit restores the default verse segmentation.
   */
  const segmentationDispatch = useMemo<SegmentationDispatch>(() => {
    /**
     * Auto-saves the result of a boundary transform, clearing the segmentation field back to
     * `undefined` when the edit restores the default verse segmentation.
     */
    const apply = (next: ReturnType<typeof mergeSegments>) => {
      autosaveSegmentation(isDefaultSegmentation(next) ? undefined : next);
    };
    return {
      merge: (secondSegmentStartRef) => {
        /* v8 ignore next -- boundary controls only render once the book has loaded */
        if (!verseBook) return;
        apply(mergeSegments(verseBook, getDraftSnapshot()?.segmentation, secondSegmentStartRef));
      },
      split: (tokenRef) => {
        /* v8 ignore next -- boundary controls only render once the book has loaded */
        if (!verseBook) return;
        apply(splitSegmentBefore(verseBook, getDraftSnapshot()?.segmentation, tokenRef));
      },
      move: (fromRef, toRef) => {
        /* v8 ignore next -- the cross-segment link only renders once the book has loaded */
        if (!verseBook) return;
        apply(moveBoundary(verseBook, getDraftSnapshot()?.segmentation, fromRef, toRef));
      },
    };
  }, [verseBook, getDraftSnapshot, autosaveSegmentation]);

  // The active reference handed to the interlinearizer. The host emits `verseNum: 0` both for a
  // chapter's verse-0 superscription (which has its own segment) and for a plain whole-chapter
  // selection (which does not): keep verse 0 when the loaded book has a verse-0 segment for that
  // chapter, otherwise fall back to the chapter's first numbered verse. A reference contained in any
  // segment's verse range passes through unchanged. A reference no segment contains (the host's
  // next-verse over-shooting the chapter's end) resolves to the nearest preceding segment start in
  // the same chapter, falling through unchanged when the chapter has none.
  const activeScrRef = useMemo(() => {
    if (!book) return scrRef;
    if (book.segments.some((segment) => segmentContainsVerse(segment, scrRef))) return scrRef;
    if (scrRef.verseNum === 0) return { ...scrRef, verseNum: 1 };
    // Search the verse starts themselves rather than each segment's `startRef`: a cross-chapter
    // segment (e.g. one starting at 4:20 but covering through 5:3) has `startRef.chapter === 4`, so
    // filtering by `startRef` would miss it when resolving an over-shoot within chapter 5. Each verse
    // start carries its own chapter, so `vs.chapter` finds the nearest preceding verse regardless of
    // where the segment's boundary falls.
    let precedingVerse: number | undefined;
    book.segments.forEach((segment) => {
      if (segment.startRef.book !== scrRef.book) return;
      segment.verseStarts.forEach((vs) => {
        if (vs.chapter !== scrRef.chapterNum) return;
        const verse = firstVerseNumber(vs.number);
        if (verse === undefined || verse > scrRef.verseNum) return;
        if (precedingVerse === undefined || verse > precedingVerse) precedingVerse = verse;
      });
    });
    return precedingVerse !== undefined ? { ...scrRef, verseNum: precedingVerse } : scrRef;
  }, [scrRef, book]);

  const hasError = !!bookError || !!tokenizeError;
  const isSettingLoading =
    isContinuousScrollLoading ||
    isHideInactiveLinkButtonsLoading ||
    isSimplifyPhrasesLoading ||
    isShowMorphologyLoading ||
    isShowFreeTranslationLoading ||
    isShowVerseGutterLoading;
  // True during a cross-book swap: the live `scrRef` already names the new book but the loaded `book`
  // is still the previous one (its USJ hasn't arrived yet). Treating this window as loading swaps the
  // old view for the Loading… curtain immediately, so nothing of either book shows until the new one
  // has mounted and fades in.
  const isCrossBookSwap = !!book && scrRef.book !== book.bookRef;
  const showLoading = isLoading || isDraftLoading || isSettingLoading || isCrossBookSwap;
  const isLoaded = !hasError && !showLoading && !!book;

  // Abort any in-flight cross-book fade when the new book fails to load, so the error is revealed
  // rather than left hidden behind a curtain that will never receive a settle.
  useEffect(() => {
    if (hasError) cancelFade();
  }, [hasError, cancelFade]);

  /**
   * Whether the analysis catalog panel is showing. Tab-scoped rather than a project setting: two
   * tabs on one project are routinely opened to look at different things, and a panel one of them
   * opened has no business appearing in the other.
   */
  const [catalogOpen, setCatalogOpen] = useWebViewState<boolean>('analysisCatalogOpen', false);

  /**
   * How the interlinear view and the catalog beside it divide the room between them, tab-scoped for
   * the same reason the catalog's open flag is.
   */
  const [catalogLayout, setCatalogLayout] = useWebViewState<PanelLayout>(
    'analysisCatalogLayout',
    DEFAULT_CATALOG_LAYOUT,
  );

  const [modal, setModal] = useState<ModalState>('none');

  /** Whether the destructive wipe dialog (book / whole-draft scope picker) is open. */
  const [wipeModalOpen, setWipeModalOpen] = useState(false);

  const [phraseMode, setPhraseMode] = useState<PhraseMode>({ kind: 'view' });

  // Reset phraseMode whenever the draft is replaced wholesale (New / Open / Wipe) so stale
  // edit/confirm-unlink state is never passed to the newly mounted Interlinearizer.
  useEffect(() => {
    setPhraseMode({ kind: 'view' });
  }, [draftVersion]);

  const isSavingRef = useRef(false);

  /**
   * Saves the current draft to the active project. When no project is active there is nothing to
   * save to yet, so it opens Save As instead. Errors are logged; the backend surfaces the
   * notification.
   */
  const handleSave = useCallback(async () => {
    if (!activeProject) {
      setModal('saveAs');
      return;
    }
    /* v8 ignore next -- re-entry guard; handles simultaneous saves during async round-trip */
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    const snapshot = getDraftSnapshot();
    /* v8 ignore next 4 -- save is only reachable once the editor (and draft) have loaded */
    if (!snapshot) {
      isSavingRef.current = false;
      return;
    }
    try {
      const savedJson = await papi.commands.sendCommand(
        'interlinearizer.saveAnalysis',
        activeProject.id,
        JSON.stringify(snapshot.analysis),
        // Send the draft's boundary state on every Save; `null` clears any stored boundaries so a
        // reverted segmentation propagates to the project rather than leaving it stale.
        // eslint-disable-next-line no-null/no-null -- "null" is the JSON sentinel that clears boundaries
        JSON.stringify(snapshot.segmentation ?? null),
      );
      // A successful save returns the saved project JSON; `undefined` means the project no longer
      // exists, so nothing was persisted — leave the draft dirty rather than marking it clean.
      if (savedJson) {
        // Fold the response's refreshed `updatedAt` into the cached active project so the picker
        // sort and the metadata modal's Modified time stay current without a reload; extract it
        // defensively so an unexpectedly shaped payload leaves the cache untouched.
        const parsed: unknown = JSON.parse(savedJson);
        const refreshedUpdatedAt =
          parsed && typeof parsed === 'object' && 'updatedAt' in parsed
            ? parsed.updatedAt
            : undefined;
        if (typeof refreshedUpdatedAt === 'string') {
          setActiveProject({ ...activeProject, updatedAt: refreshedUpdatedAt });
        }
        markSynced(snapshot.analysis, snapshot.segmentation);
      }
    } catch (e) {
      logger.error('Interlinearizer: failed to save draft to project', e);
    } finally {
      isSavingRef.current = false;
    }
  }, [activeProject, getDraftSnapshot, markSynced, setActiveProject, setModal]);

  /**
   * Performs the confirmed wipe for the chosen scope (current book or whole draft) and dismisses
   * the dialog.
   */
  const handleWipeConfirm = useCallback(
    (scope: WipeScope) => {
      if (scope === 'book') {
        /* v8 ignore next -- defensive: the dialog disables the book scope unless a book is loaded */
        if (book) wipeBook(book.bookRef);
      }
      // Match 'all' explicitly rather than via an else, so a future wipe scope can't fall through to
      // the destructive whole-draft wipe.
      if (scope === 'all') wipeAll();
      setWipeModalOpen(false);
    },
    [book, wipeBook, wipeAll],
  );

  /** Dismisses the wipe dialog, leaving the draft untouched. */
  const handleWipeCancel = useCallback(() => setWipeModalOpen(false), []);

  /** Dismisses the analysis catalog panel. */
  const handleCatalogClose = useCallback(() => setCatalogOpen(false), [setCatalogOpen]);

  /**
   * Records a layout the group reports, keeping the stored one naming both panels. A group reports
   * a layout over the panels mounted at the time, so a closed catalog is reported absent rather
   * than at the width it was left at, and storing that would lose the width for the reopening.
   */
  const handleCatalogLayoutChanged = useCallback(
    (layout: PanelLayout) => {
      if (VIEW_PANEL_ID in layout && CATALOG_PANEL_ID in layout) setCatalogLayout(layout);
    },
    [setCatalogLayout],
  );

  /**
   * Moves the catalog group's panels, the group reading its `defaultLayout` only as it mounts and
   * so staying where it is for any later layout written to state alone.
   */
  // eslint-disable-next-line no-null/no-null
  const catalogGroupRef: GroupHandleRef = useRef(null);

  /**
   * Moves the catalog to a percentage of the group a key press asked it be given, the view taking
   * the rest. Storing the new width is left to the group's own report of what it settled on: a
   * percentage the pixel limits do not allow is clamped on the way in, and storing the percentage
   * asked for instead would record a width the catalog never took.
   */
  const handleCatalogPercentageChange = useCallback((percentage: number) => {
    catalogGroupRef.current?.setLayout({
      [VIEW_PANEL_ID]: 100 - percentage,
      [CATALOG_PANEL_ID]: percentage,
    });
  }, []);

  /**
   * Restores the width the catalog was last left at as it opens. The group outlives the panel and
   * honors `defaultLayout` only while every panel it names is mounted, so the layout held for a
   * closed catalog is not one the group will have applied by itself.
   */
  const catalogLayoutRef = useRef(catalogLayout);
  catalogLayoutRef.current = catalogLayout;
  useEffect(() => {
    if (catalogOpen) catalogGroupRef.current?.setLayout(catalogLayoutRef.current);
  }, [catalogOpen]);

  const catalogResizeRef = usePanelResizeKeys(
    /* v8 ignore next -- every stored layout names the catalog, the default included */
    catalogLayout[CATALOG_PANEL_ID] ?? DEFAULT_CATALOG_LAYOUT[CATALOG_PANEL_ID],
    handleCatalogPercentageChange,
    CATALOG_PERCENTAGE_BOUNDS,
  );

  /**
   * Routes top-menu commands to the appropriate action. The project commands open their modals; the
   * file commands save (or open Save As); the draft command opens the wipe dialog.
   */
  const menuCommandHandler = useCallback<SelectMenuItemHandler>(
    (item) => {
      if (item.command === 'interlinearizer.openSelectProjectModal') {
        setModal('select');
      } else if (item.command === 'interlinearizer.openNewProjectModal') {
        setModal('create');
      } else if (item.command === 'interlinearizer.openProjectInfoModal') {
        if (activeProject) {
          setModal('metadata');
        }
      } else if (item.command === 'interlinearizer.save') {
        handleSave();
      } else if (item.command === 'interlinearizer.openSaveAsModal') {
        setModal('saveAs');
      } else if (item.command === 'interlinearizer.wipe') {
        setWipeModalOpen(true);
      } else if (item.command === 'interlinearizer.openAnalysisCatalog') {
        setCatalogOpen(true);
      }
    },
    [activeProject, handleSave, setCatalogOpen],
  );

  /**
   * Fetches the raw top-menu data for this WebView from the platform's menu data provider. This
   * call performs no filtering; the active-project hiding of the "View Project Info" item is
   * applied separately in {@link projectMenuData}.
   */
  const [webViewMenuPossiblyError] = useData(papi.menuData.dataProviderName).WebViewMenu(
    'interlinearizer.mainWebView',
    DEFAULT_WEB_VIEW_MENU,
  );

  /**
   * Top-menu descriptor passed to {@link TabToolbar}. Identical to
   * `webViewMenuPossiblyError.topMenu` except that the `interlinearizer.openProjectInfoModal` item
   * is filtered out when no project is active, since that command requires an active project to act
   * on.
   */
  const projectMenuData = useMemo(() => {
    /* v8 ignore next 3 -- PlatformError from useData is not reachable through the mock */
    const menu =
      webViewMenuPossiblyError && !isPlatformError(webViewMenuPossiblyError)
        ? webViewMenuPossiblyError
        : DEFAULT_WEB_VIEW_MENU;
    if (!menu.topMenu || activeProject) return menu.topMenu;
    const { items } = menu.topMenu;
    /* v8 ignore next */ if (!Array.isArray(items)) return menu.topMenu;
    return {
      ...menu.topMenu,
      items: items.filter(
        (item) => !('command' in item) || item.command !== 'interlinearizer.openProjectInfoModal',
      ),
    };
  }, [webViewMenuPossiblyError, activeProject]);

  const loadingOrErrorPanel = (
    <div className="tw:flex tw:flex-col tw:gap-4 tw:p-4">
      {bookError && (
        <div className="tw:flex tw:flex-col tw:gap-2">
          <h2 className="tw:error-heading">
            {localizedStrings['%interlinearizer_error_load_book_heading%']}
          </h2>
          <pre className="tw:error-pre">{bookError}</pre>
        </div>
      )}

      {tokenizeError && (
        <div className="tw:flex tw:flex-col tw:gap-2">
          <h2 className="tw:error-heading">
            {localizedStrings['%interlinearizer_error_process_book_heading%']}
          </h2>
          <pre className="tw:error-pre">{tokenizeError.message}</pre>
        </div>
      )}

      {!hasError && showLoading && (
        <p className="tw:text-sm tw:text-muted-foreground" data-testid="loading-indicator">
          {/* This panel is the first paint of the view, before localization has resolved. */}
          {resolvedOrEmpty(localizedStrings['%interlinearizer_loading%'])}
        </p>
      )}
    </div>
  );

  const bookArea =
    hasError || showLoading || !book ? (
      loadingOrErrorPanel
    ) : (
      <Interlinearizer
        key={book.bookRef}
        book={book}
        continuousScroll={continuousScroll}
        scrRef={activeScrRef}
        phraseMode={phraseMode}
        setPhraseMode={setPhraseMode}
        viewOptions={viewOptions}
        segmentationDispatch={segmentationDispatch}
        formerBoundaries={formerBoundaries}
        segmentationVersion={segmentationVersion}
      />
    );

  return (
    <div className="tw:flex tw:flex-col tw:h-full">
      <TabToolbar
        className="tw:z-10"
        projectMenuData={projectMenuData}
        startAreaChildren={
          interfaceMode === 'power' ? (
            <ScriptureNavControls
              scrRef={scrRef}
              handleSubmit={navigate}
              scrollGroupId={scrollGroupId}
              onChangeScrollGroupId={setScrollGroupId}
            />
          ) : undefined
        }
        endAreaChildren={
          isLoaded ? (
            <ViewOptionsDropdown
              continuousScroll={continuousScroll}
              onContinuousScrollChange={handleContinuousScrollChange}
              hideInactiveLinkButtons={hideInactiveLinkButtons}
              onHideInactiveLinkButtonsChange={handleHideInactiveLinkButtonsChange}
              simplifyPhrases={simplifyPhrases}
              onSimplifyPhrasesChange={handleSimplifyPhrasesChange}
              showMorphology={showMorphology}
              onShowMorphologyChange={handleShowMorphologyChange}
              showFreeTranslation={showFreeTranslation}
              onShowFreeTranslationChange={handleShowFreeTranslationChange}
              showVerseGutter={showVerseGutter}
              onShowVerseGutterChange={handleShowVerseGutterChange}
              showSuggestions={showSuggestions}
              onShowSuggestionsChange={setShowSuggestions}
            />
          ) : undefined
        }
        onSelectProjectMenuItem={menuCommandHandler}
        /* v8 ignore next 3 -- stub required by TabToolbar API, no behavior to test */
        onSelectViewInfoMenuItem={() => {
          logger.warn('Interlinearizer: unexpected onSelectViewInfoMenuItem call');
        }}
      />

      <div className="tw:flex tw:flex-1 tw:min-h-0">
        {isDraftLoading ? (
          // The store below waits for the draft: it seeds on mount alone, and the draft version
          // that remounts it does not bump when the load completes. Nothing is lost by waiting —
          // while the draft loads there is only ever a placeholder or an error panel to show.
          <BookFadeWrapper fadePhase={fadePhase}>{loadingOrErrorPanel}</BookFadeWrapper>
        ) : (
          // The store's lifetime is the draft's, not the loaded book's — it holds every book.
          // Keyed on the draft version because the seed is not reactive, so a wholesale replacement
          // (New / Open / Wipe) reseeds by remounting. Wrapping the loading and error branches too
          // keeps it alive across the gap while the next book's USJ is in flight.
          //
          // Declared above the cross-book curtain, not inside it, so the catalog panel can read the
          // store without being dimmed by it: a jump to a usage in another book fades the view it
          // navigates, and fading the list the jump was made from along with it would blank the
          // panel at precisely the moment it is being used.
          <AnalysisStoreProvider
            key={draftVersion}
            initialAnalysis={draft?.analysis}
            analysisLanguage={analysisLanguage}
            onSave={autosaveAnalysis}
            onPendingEditsChange={setPendingEdits}
            showSuggestions={showSuggestions}
          >
            {/*
             * The group stays mounted whether or not the catalog is open, only the catalog's own
             * panel coming and going, so that the view keeps one place in the tree. A view that
             * changed place here would remount, losing what the reader was in the middle of: where
             * the segment list was scrolled to, a gloss typed but not yet committed, an open
             * breakdown editor.
             */}
            <ResizablePanelGroup
              className="tw:flex tw:flex-1 tw:min-h-0"
              defaultLayout={catalogLayout}
              groupRef={catalogGroupRef}
              onLayoutChanged={handleCatalogLayoutChanged}
              orientation="horizontal"
            >
              <ResizablePanel id={VIEW_PANEL_ID} minSize={MIN_VIEW_WIDTH}>
                <BookFadeWrapper fadePhase={fadePhase}>{bookArea}</BookFadeWrapper>
              </ResizablePanel>
              {catalogOpen && (
                <>
                  <ResizableHandle
                    aria-label={localizedStrings['%interlinearizer_analysisCatalog_resize%']}
                    data-testid="analysis-catalog-resize"
                    elementRef={catalogResizeRef}
                  />
                  <ResizablePanel
                    id={CATALOG_PANEL_ID}
                    maxSize={MAX_CATALOG_WIDTH}
                    minSize={MIN_CATALOG_WIDTH}
                  >
                    <AnalysisCatalogPanel
                      // The live reference, not the loaded book: during a cross-book jump the view
                      // is mid-load, and counting against the book being left would relabel every
                      // row for the duration.
                      currentBook={scrRef.book}
                      onClose={handleCatalogClose}
                      sourceLanguageTag={writingSystem}
                    />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </AnalysisStoreProvider>
        )}
      </div>

      <ProjectModals
        activeProject={activeProject}
        defaultAnalysisLanguage={platformLanguage}
        hasUnsavedWork={hasUnsavedChanges}
        getDraftSnapshot={getDraftSnapshot}
        loadFromProject={loadFromProject}
        newDraft={newDraft}
        markSynced={markSynced}
        modal={modal}
        projectId={projectId}
        setModal={setModal}
        useWebViewState={useWebViewState}
      />

      {wipeModalOpen && (
        <WipeModal
          hasActiveBook={!!book}
          onConfirm={handleWipeConfirm}
          onCancel={handleWipeCancel}
        />
      )}
    </div>
  );
}
