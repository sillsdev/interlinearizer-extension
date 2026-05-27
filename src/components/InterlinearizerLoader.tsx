import type { UseWebViewScrollGroupScrRefHook, UseWebViewStateHook } from '@papi/core';
import papi, { logger } from '@papi/frontend';
import { useData, useLocalizedStrings, useSetting } from '@papi/frontend/react';
import type { InterlinearProject, TextAnalysis } from 'interlinearizer';
import { TabToolbar } from 'platform-bible-react';
import type { SelectMenuItemHandler } from 'platform-bible-react';
import { isPlatformError } from 'platform-bible-utils';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useInterlinearizerBookData from '../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../hooks/useOptimisticBooleanSetting';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';
import ContinuousScrollToggle from './ContinuousScrollToggle';
import Interlinearizer from './Interlinearizer';
import ProjectModals, { type ModalState } from './ProjectModals';
import ScriptureNavControls from './ScriptureNavControls';

/** Localized string keys used by {@link InterlinearizerLoader}. */
const STRING_KEYS: `%${string}%`[] = ['%interlinearizer_continuousScrollToggle%'];

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
  const [scrRef, setScrRef, scrollGroupId, setScrollGroupId] = useWebViewScrollGroupScrRef();

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
      return;
    }

    let cancelled = false;
    setIsAnalysisLoading(true);

    const loadAnalysis = async () => {
      try {
        const json = await papi.commands.sendCommand(
          'interlinearizer.getProject',
          activeProject.id,
        );
        if (cancelled) return;
        if (json) {
          const project: InterlinearProject = JSON.parse(json);
          setActiveProjectAnalysis(project.analysis);
        } else {
          setActiveProjectAnalysis(undefined);
        }
      } catch (e) {
        if (!cancelled) {
          logger.error('Interlinearizer: failed to load project analysis', e);
          setActiveProjectAnalysis(undefined);
        }
      } finally {
        if (!cancelled) setIsAnalysisLoading(false);
      }
    };

    loadAnalysis().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Persists an updated analysis to the backend after each gloss write. No-ops when no project is
   * active. Errors are logged but not surfaced — the backend already sends an error notification.
   *
   * @param analysis - The updated `TextAnalysis` to persist.
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
    isLoading: isSettingLoading,
    onChange: handleContinuousScrollChange,
    value: continuousScroll,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.continuousScroll', true);

  const { book, chapterSegments, isLoading, bookError, tokenizeError } = useInterlinearizerBookData(
    { projectId, scrRef },
  );

  const hasError = !!bookError || !!tokenizeError;
  const showLoading = isLoading || isSettingLoading || isAnalysisLoading;

  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);

  const [modal, setModal] = useState<ModalState>('none');

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
              scrRef={scrRef}
              handleSubmit={setScrRef}
              scrollGroupId={scrollGroupId}
              onChangeScrollGroupId={setScrollGroupId}
            />
          ) : undefined
        }
        endAreaChildren={
          <ContinuousScrollToggle
            checked={continuousScroll}
            disabled={isSettingLoading}
            label={localizedStrings['%interlinearizer_continuousScrollToggle%']}
            onCheckedChange={handleContinuousScrollChange}
          />
        }
        onSelectProjectMenuItem={menuCommandHandler}
        /* v8 ignore next 3 -- stub required by TabToolbar API, no behaviour to test */
        onSelectViewInfoMenuItem={() => {
          logger.warn('Interlinearizer: unexpected onSelectViewInfoMenuItem call');
        }}
      />

      {hasError || showLoading || !book ? (
        <div className="tw:flex tw:flex-col tw:gap-4 tw:p-4">
          {bookError && (
            <div className="tw:flex tw:flex-col tw:gap-2">
              <h2 className="tw:text-lg tw:font-medium tw:text-destructive">Error loading book</h2>
              <pre className="tw:overflow-auto tw:rounded-md tw:bg-muted tw:text-foreground tw:p-4 tw:text-sm">
                {bookError}
              </pre>
            </div>
          )}

          {tokenizeError && (
            <div className="tw:flex tw:flex-col tw:gap-2">
              <h2 className="tw:text-lg tw:font-medium tw:text-destructive">
                Error processing book
              </h2>
              <pre className="tw:overflow-auto tw:rounded-md tw:bg-muted tw:text-foreground tw:p-4 tw:text-sm">
                {tokenizeError.message}
              </pre>
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
          chapterSegments={chapterSegments}
          continuousScroll={continuousScroll}
          scrRef={scrRef}
          setScrRef={setScrRef}
          analysisLanguage={analysisLanguage}
          initialAnalysis={activeProjectAnalysis}
          onSaveAnalysis={handleSaveAnalysis}
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
