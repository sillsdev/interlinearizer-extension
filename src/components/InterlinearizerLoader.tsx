import type { UseWebViewScrollGroupScrRefHook, UseWebViewStateHook } from '@papi/core';
import papi, { logger } from '@papi/frontend';
import { useData, useSetting } from '@papi/frontend/react';
import type { InterlinearProject, TextAnalysis } from 'interlinearizer';
import { TabToolbar } from 'platform-bible-react';
import type { SelectMenuItemHandler } from 'platform-bible-react';
import { isPlatformError } from 'platform-bible-utils';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useInterlinearizerBookData from '../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../hooks/useOptimisticBooleanSetting';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';
import Interlinearizer from './Interlinearizer';
import ViewOptionsDropdown from './controls/ViewOptionsDropdown';
import type { PhraseMode } from '../types/phrase-mode';
import ProjectModals, { type ModalState } from './modals/ProjectModals';
import ScriptureNavControls from './controls/ScriptureNavControls';

/**
 * Root component for the Interlinearizer WebView. Loads book data and settings, manages modal state
 * for project creation/selection/metadata, then renders error and loading states or delegates to
 * {@link Interlinearizer} when data is ready.
 *
 * @param props - Component props
 * @param props.projectId - PAPI project ID passed from the host
 * @param props.useWebViewScrollGroupScrRef - Hook that exposes the shared scroll-group scripture
 *   reference and its setter
 * @param props.useWebViewState - Hook for reading and writing typed WebView-scoped state persisted
 *   by the PAPI host
 * @returns The toolbar and either an error/loading state or the fully rendered
 *   {@link Interlinearizer}
 */
export default function InterlinearizerLoader({
  projectId,
  useWebViewScrollGroupScrRef,
  useWebViewState,
}: Readonly<{
  projectId: string;
  useWebViewScrollGroupScrRef: UseWebViewScrollGroupScrRefHook;
  useWebViewState: UseWebViewStateHook;
}>) {
  const [rawScrRef, setScrRef, scrollGroupId, setScrollGroupId] = useWebViewScrollGroupScrRef();

  /**
   * `rawScrRef` with a chapter-level (verse 0) reference normalized to verse 1. Selecting a chapter
   * in the scripture controls yields `verseNum: 0`, which names the chapter rather than a verse —
   * no segment has verse 0, so the active-verse lookup, the `isActive` highlight, and the
   * continuous strip's focus resolution would all miss, leaving the list parked on the book's first
   * phrase with nothing highlighted. Mapping verse 0 to the chapter's first verse makes every
   * downstream consumer resolve the intended verse. The raw reference still drives the editable nav
   * controls so the user's chapter selection is reflected verbatim there.
   */
  const scrRef = useMemo(
    () => (rawScrRef.verseNum === 0 ? { ...rawScrRef, verseNum: 1 } : rawScrRef),
    [rawScrRef],
  );

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

  /**
   * BCP 47 tag used for reading and writing gloss values. Prefers the active project's first
   * configured analysis language; falls back to the platform UI language when no project is
   * active.
   */
  const analysisLanguage = activeProject?.analysisLanguages[0] ?? platformLanguage;

  /**
   * `TextAnalysis` loaded from storage for the currently active interlinear project, or `undefined`
   * when no project is active or the load is still in flight. Passed to {@link Interlinearizer} as
   * `initialAnalysis` to seed the Redux store on mount.
   */
  const [activeProjectAnalysis, setActiveProjectAnalysis] = useState<TextAnalysis | undefined>(
    undefined,
  );

  /**
   * `true` while the `interlinearizer.getProject` command is in flight for the current
   * `activeProject`. Blocks rendering {@link Interlinearizer} until the analysis is ready so the
   * store is never seeded with stale data from a previous project.
   */
  const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);

  useEffect(() => {
    if (!activeProject) {
      setActiveProjectAnalysis(undefined);
      setIsAnalysisLoading(false);
      return;
    }

    let canceled = false;
    setIsAnalysisLoading(true);

    /**
     * Fetches the stored `TextAnalysis` for the active project and updates component state.
     *
     * Writes `activeProjectAnalysis` on success (or `undefined` when the project record is absent)
     * and clears `isAnalysisLoading` in the `finally` block. Both state updates are suppressed when
     * `canceled` is `true` (i.e. the effect was cleaned up before the fetch completed).
     *
     * @returns Promise that resolves to void once state has been updated or the update has been
     *   suppressed due to cancellation.
     * @throws Never — errors are caught internally and logged; `activeProjectAnalysis` is set to
     *   `undefined` on failure.
     */
    const loadAnalysis = async () => {
      try {
        const json = await papi.commands.sendCommand(
          'interlinearizer.getProject',
          activeProject.id,
        );
        if (canceled) return;
        if (json) {
          const project: InterlinearProject = JSON.parse(json);
          setActiveProjectAnalysis(project.analysis);
        } else {
          setActiveProjectAnalysis(undefined);
        }
      } catch (e) {
        if (!canceled) {
          logger.error('Interlinearizer: failed to load project analysis', e);
          setActiveProjectAnalysis(undefined);
        }
      } finally {
        if (!canceled) setIsAnalysisLoading(false);
      }
    };

    loadAnalysis().catch(() => {});

    return () => {
      canceled = true;
    };
  }, [activeProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Persists an updated analysis to the backend after each gloss write. No-ops when no project is
   * active. Errors are logged but not surfaced — the backend already sends an error notification.
   *
   * @param analysis - The updated `TextAnalysis` to persist.
   * @returns Void — the underlying command is fire-and-forget; errors are caught and logged.
   */
  const handleSaveAnalysis = useCallback(
    (analysis: TextAnalysis) => {
      if (!activeProject) return;
      papi.commands
        .sendCommand('interlinearizer.saveAnalysis', activeProject.id, JSON.stringify(analysis))
        .catch((e) => logger.error('Interlinearizer: failed to save analysis', e));
    },
    [activeProject],
  );

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

  const { book, isLoading, bookError, tokenizeError } = useInterlinearizerBookData({
    projectId,
    scrRef,
  });

  const hasError = !!bookError || !!tokenizeError;
  const isSettingLoading =
    isContinuousScrollLoading || isHideInactiveLinkButtonsLoading || isSimplifyPhrasesLoading;
  const showLoading = isLoading || isAnalysisLoading || isSettingLoading;
  const isLoaded = !hasError && !showLoading && !!book;

  const [modal, setModal] = useState<ModalState>('none');

  const [phraseMode, setPhraseMode] = useState<PhraseMode>({ kind: 'view' });

  // Reset phraseMode when the active project changes so stale edit/confirm-unlink state from a
  // previous project is never passed to the newly mounted Interlinearizer.
  useEffect(() => {
    setPhraseMode({ kind: 'view' });
  }, [activeProject?.id]);

  /**
   * Routes top-menu commands to the appropriate modal. `openSelectProjectModal` opens the select
   * modal; `openNewProjectModal` opens the create modal directly; `openProjectInfoModal` opens the
   * metadata modal for the currently active project.
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
      }
    },
    [activeProject],
  );

  /**
   * Fetches the top-menu data for this WebView from the platform's menu data provider, hiding "View
   * Project Info" when no interlinear project is currently active.
   */
  const [webViewMenuPossiblyError] = useData(papi.menuData.dataProviderName).WebViewMenu(
    'interlinearizer.mainWebView',
    { topMenu: undefined, includeDefaults: true, contextMenu: undefined },
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
        : { topMenu: undefined, includeDefaults: true, contextMenu: undefined };
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
              handleSubmit={setScrRef}
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
            />
          ) : undefined
        }
        onSelectProjectMenuItem={menuCommandHandler}
        /* v8 ignore next 3 -- stub required by TabToolbar API, no behavior to test */
        onSelectViewInfoMenuItem={() => {
          logger.warn('Interlinearizer: unexpected onSelectViewInfoMenuItem call');
        }}
      />

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
          key={activeProject?.id ?? ''}
          book={book}
          continuousScroll={continuousScroll}
          scrRef={scrRef}
          setScrRef={setScrRef}
          analysisLanguage={analysisLanguage}
          initialAnalysis={activeProjectAnalysis}
          onSaveAnalysis={handleSaveAnalysis}
          phraseMode={phraseMode}
          setPhraseMode={setPhraseMode}
          hideInactiveLinkButtons={hideInactiveLinkButtons}
          simplifyPhrases={simplifyPhrases}
        />
      )}

      <ProjectModals
        activeProject={activeProject}
        defaultAnalysisLanguage={platformLanguage}
        modal={modal}
        projectId={projectId}
        setModal={setModal}
        useWebViewState={useWebViewState}
      />
    </div>
  );
}
