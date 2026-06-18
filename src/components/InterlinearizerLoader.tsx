import type {
  UseWebViewScrollGroupScrRefHook,
  UseWebViewStateHook,
  WebViewProps,
} from '@papi/core';
import papi, { logger } from '@papi/frontend';
import { useData, useSetting } from '@papi/frontend/react';
import { TabToolbar } from 'platform-bible-react';
import type { SelectMenuItemHandler } from 'platform-bible-react';
import { isPlatformError } from 'platform-bible-utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useDraftProject from '../hooks/useDraftProject';
import useInterlinearizerBookData from '../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../hooks/useOptimisticBooleanSetting';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';
import Interlinearizer from './Interlinearizer';
import ViewOptionsDropdown from './controls/ViewOptionsDropdown';
import type { PhraseMode } from '../types/phrase-mode';
import ProjectModals, { type ModalState } from './modals/ProjectModals';
import { WipeConfirm } from './modals/WipeConfirm';
import ScriptureNavControls from './controls/ScriptureNavControls';
import { InterlinearNavProvider, useInterlinearNav } from './InterlinearNavContext';
import { RECENTER_FADE_TRANSITION_STYLE } from './recenter-fade';

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
 * so {@link UNSAVED_TAB_MARKER} is appended to this via `updateWebViewDefinition` while the draft
 * has unsaved changes.
 */
const BASE_TAB_TITLE = 'Interlinearizer';

/** Glyph appended to the tab title while the draft has unsaved changes. */
const UNSAVED_TAB_MARKER = ' ●';

/**
 * Root component for the Interlinearizer WebView. Mounts the {@link InterlinearNavProvider} so the
 * loader and the whole {@link Interlinearizer} subtree read and write navigation through one source
 * of truth, then delegates the actual loading/rendering to {@link InterlinearizerLoaderInner}.
 *
 * @param props - Component props
 * @param props.projectId - PAPI project ID passed from the host
 * @param props.useWebViewScrollGroupScrRef - Hook that exposes the shared scroll-group scripture
 *   reference and its setter
 * @param props.useWebViewState - Hook for reading and writing typed WebView-scoped state persisted
 *   by the PAPI host
 * @param props.updateWebViewDefinition - Host-injected callback to update this WebView's
 *   definition; used to toggle the tab's unsaved-changes title marker
 * @returns The nav provider wrapping {@link InterlinearizerLoaderInner}
 */
export default function InterlinearizerLoader({
  projectId,
  useWebViewScrollGroupScrRef,
  useWebViewState,
  updateWebViewDefinition,
}: Readonly<{
  projectId: string;
  useWebViewScrollGroupScrRef: UseWebViewScrollGroupScrRefHook;
  useWebViewState: UseWebViewStateHook;
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
 *
 * @param props - Component props
 * @param props.projectId - PAPI project ID passed from the host
 * @param props.useWebViewState - Hook for reading and writing typed WebView-scoped state persisted
 *   by the PAPI host
 * @param props.updateWebViewDefinition - Host-injected callback used to toggle the tab's
 *   unsaved-changes title marker
 * @returns The toolbar and either an error/loading state or the fully rendered
 *   {@link Interlinearizer}
 */
function InterlinearizerLoaderInner({
  projectId,
  useWebViewState,
  updateWebViewDefinition,
}: Readonly<{
  projectId: string;
  useWebViewState: UseWebViewStateHook;
  updateWebViewDefinition: UpdateWebViewDefinition;
}>) {
  const {
    rawScrRef,
    liveScrRef: scrRef,
    navigate,
    scrollGroupId,
    setScrollGroupId,
    fadePhase,
    cancelFade,
  } = useInterlinearNav();

  const [interfaceMode] = useSetting('platform.interfaceMode', 'simple');
  const [interfaceLanguages] = useSetting('platform.interfaceLanguage', ['und']);
  /* v8 ignore next 3 -- useSetting never returns PlatformError for this key in practice */
  const platformLanguage = isPlatformError(interfaceLanguages)
    ? 'und'
    : interfaceLanguages[0] || 'und';

  /**
   * Persisted snapshot of the active interlinear project — kept in WebView state so it survives tab
   * restores. The setter lives in {@link ProjectModals}, which writes to the same `'activeProject'`
   * key; this component reads the value to decide which menu items to show and which analysis
   * language to use.
   */
  const [activeProject] = useWebViewState<InterlinearProjectSummary | undefined>(
    'activeProject',
    undefined,
  );

  // The always-present draft is the runtime source of truth for the analysis being edited. Edits
  // auto-save here (not to the active project); Save / Save As copy the draft into a project.
  const {
    isDraftLoading,
    draft,
    draftVersion,
    dirty,
    autosaveAnalysis,
    loadFromProject,
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
  // unsaved indicator light up the moment the user starts typing. A draft swap (New / Open / Wipe /
  // book change) remounts the editor, whose gloss inputs unregister on unmount, so the provider
  // reports `false` and this clears back to a clean baseline.
  const [pendingEdits, setPendingEdits] = useState(false);

  // Reflect the draft's unsaved-changes state in the tab title. PAPI has no native dirty indicator,
  // so we append a marker to the title via the host-injected `updateWebViewDefinition`. The marker
  // shows for both committed changes (`dirty`) and in-progress typing (`pendingEdits`).
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
    isLoading: isChapterLabelInVerseLoading,
    onChange: handleChapterLabelInVerseChange,
    value: chapterLabelInVerse,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.chapterLabelInVerse', false);

  const {
    isLoading: isShowMorphologyLoading,
    onChange: handleShowMorphologyChange,
    value: showMorphology,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.showMorphology', false);

  // Bundle the display toggles into one stable object. Memoizing on the primitive values keeps
  // the reference identical across the loader's frequent re-renders (driven by `useData`,
  // `useSetting`, etc.), so the `memo()` wrapping `SegmentView` can shallow-compare it away instead
  // of re-rendering every windowed segment when no toggle actually changed.
  const viewOptions = useMemo(
    () => ({ hideInactiveLinkButtons, simplifyPhrases, chapterLabelInVerse, showMorphology }),
    [hideInactiveLinkButtons, simplifyPhrases, chapterLabelInVerse, showMorphology],
  );

  const { book, isLoading, bookError, tokenizeError } = useInterlinearizerBookData({
    projectId,
    scrRef,
  });

  const hasError = !!bookError || !!tokenizeError;
  const isSettingLoading =
    isContinuousScrollLoading ||
    isHideInactiveLinkButtonsLoading ||
    isSimplifyPhrasesLoading ||
    isChapterLabelInVerseLoading ||
    isShowMorphologyLoading;
  // True during a cross-book swap: the live `scrRef` already names the new book but the loaded `book`
  // is still the previous one (its USJ hasn't arrived yet). The old `Interlinearizer` is still
  // mounted here; showing it (even frozen on its last in-book reference) lets the previous book's
  // components stay visible while the new book loads, so the swap is seen before the fade hides it.
  // Treating this window as loading swaps the old view for the Loading… curtain immediately, so
  // nothing of either book shows until the new one has mounted and fades in.
  const isCrossBookSwap = !!book && scrRef.book !== book.bookRef;
  const showLoading = isLoading || isDraftLoading || isSettingLoading || isCrossBookSwap;
  const isLoaded = !hasError && !showLoading && !!book;

  // Abort any in-flight cross-book fade when the new book fails to load, so the error is revealed
  // rather than left hidden behind a curtain that will never receive a settle.
  useEffect(() => {
    if (hasError) cancelFade();
  }, [hasError, cancelFade]);

  const [modal, setModal] = useState<ModalState>('none');

  /** Which destructive wipe confirmation is showing, or `undefined` when none. */
  const [wipeConfirm, setWipeConfirm] = useState<'book' | 'all' | undefined>(undefined);

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
   *
   * @returns A promise that resolves once the save completes or Save As is opened.
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
      await papi.commands.sendCommand(
        'interlinearizer.saveAnalysis',
        activeProject.id,
        JSON.stringify(snapshot.analysis),
      );
      markSynced(snapshot.analysis);
    } catch (e) {
      logger.error('Interlinearizer: failed to save draft to project', e);
    } finally {
      isSavingRef.current = false;
    }
  }, [activeProject, getDraftSnapshot, markSynced, setModal]);

  /** Performs the confirmed wipe (current book or whole draft) and dismisses the confirmation. */
  const handleWipeConfirm = useCallback(() => {
    if (wipeConfirm === 'book') {
      /* v8 ignore next -- wipe-book is only offered once a book is loaded */
      if (book) wipeBook(book.bookRef);
    }
    // Match 'all' explicitly rather than via an else, so a future wipe scope can't fall through to
    // the destructive whole-draft wipe.
    if (wipeConfirm === 'all') wipeAll();
    setWipeConfirm(undefined);
  }, [wipeConfirm, book, wipeBook, wipeAll]);

  /** Dismisses the wipe confirmation, leaving the draft untouched. */
  const handleWipeCancel = useCallback(() => setWipeConfirm(undefined), []);

  /**
   * Routes top-menu commands to the appropriate action. The project commands open their modals; the
   * file commands save (or open Save As); the draft commands open a wipe confirmation.
   *
   * @param item - The menu item that was activated.
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
      } else if (item.command === 'interlinearizer.wipeBook') {
        setWipeConfirm('book');
      } else if (item.command === 'interlinearizer.wipeDraft') {
        setWipeConfirm('all');
      }
    },
    [activeProject, handleSave],
  );

  /**
   * Fetches the top-menu data for this WebView from the platform's menu data provider, hiding "View
   * Project Info" when no interlinear project is currently active.
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

  return (
    <div className="tw:flex tw:flex-col tw:h-full">
      <TabToolbar
        className="tw:z-10"
        projectMenuData={projectMenuData}
        startAreaChildren={
          interfaceMode === 'power' ? (
            <ScriptureNavControls
              scrRef={rawScrRef}
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
              chapterLabelInVerse={chapterLabelInVerse}
              onChapterLabelInVerseChange={handleChapterLabelInVerseChange}
              showMorphology={showMorphology}
              onShowMorphologyChange={handleShowMorphologyChange}
            />
          ) : undefined
        }
        onSelectProjectMenuItem={menuCommandHandler}
        /* v8 ignore next 3 -- stub required by TabToolbar API, no behavior to test */
        onSelectViewInfoMenuItem={() => {
          logger.warn('Interlinearizer: unexpected onSelectViewInfoMenuItem call');
        }}
      />

      <div
        data-testid="book-fade-wrapper"
        className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:transition-opacity"
        // The fade-out must hide content instantly, not transition to 0: the old book is swapped
        // for the Loading… placeholder in the same commit the curtain drops, so a gradual descent
        // has nothing left to fade — it only lets the new book ghost in at partial opacity when a
        // fast load mounts it mid-descent, then dim and rise again (the "false-start fade"). A
        // zero-duration descent enforces the intended contract — nothing of either book shows
        // until the new one has mounted and fades in — while the rise (`in` → `idle`) keeps the
        // shared recenter timing.
        style={{
          opacity: fadePhase === 'out' ? 0 : 1,
          ...RECENTER_FADE_TRANSITION_STYLE,
          ...(fadePhase === 'out' ? { transitionDuration: '0ms' } : undefined),
        }}
      >
        {hasError || showLoading || !book ? (
          <div className="tw:flex tw:flex-col tw:gap-4 tw:p-4">
            {bookError && (
              <div className="tw:flex tw:flex-col tw:gap-2">
                <h2 className="tw:error-heading">Error loading book</h2>
                <pre className="tw:error-pre">{bookError}</pre>
              </div>
            )}

            {tokenizeError && (
              <div className="tw:flex tw:flex-col tw:gap-2">
                <h2 className="tw:error-heading">Error processing book</h2>
                <pre className="tw:error-pre">{tokenizeError.message}</pre>
              </div>
            )}

            {!hasError && showLoading && (
              <p className="tw:text-sm tw:text-muted-foreground">Loading…</p>
            )}
          </div>
        ) : (
          <Interlinearizer
            key={`${draftVersion}:${book.bookRef}`}
            book={book}
            continuousScroll={continuousScroll}
            scrRef={scrRef}
            analysisLanguage={analysisLanguage}
            initialAnalysis={draft?.analysis}
            onSaveAnalysis={autosaveAnalysis}
            onPendingEditsChange={setPendingEdits}
            phraseMode={phraseMode}
            setPhraseMode={setPhraseMode}
            viewOptions={viewOptions}
          />
        )}
      </div>

      <ProjectModals
        activeProject={activeProject}
        defaultAnalysisLanguage={platformLanguage}
        dirty={dirty}
        getDraftSnapshot={getDraftSnapshot}
        loadFromProject={loadFromProject}
        markSynced={markSynced}
        modal={modal}
        projectId={projectId}
        setModal={setModal}
        useWebViewState={useWebViewState}
      />

      {wipeConfirm && (
        <WipeConfirm
          scope={wipeConfirm}
          onConfirm={handleWipeConfirm}
          onCancel={handleWipeCancel}
        />
      )}
    </div>
  );
}
