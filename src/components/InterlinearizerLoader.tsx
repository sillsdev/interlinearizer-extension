import type { UseWebViewScrollGroupScrRefHook, UseWebViewStateHook } from '@papi/core';
import papi, { logger } from '@papi/frontend';
import { useData, useLocalizedStrings } from '@papi/frontend/react';
import { TabToolbar } from 'platform-bible-react';
import type { SelectMenuItemHandler } from 'platform-bible-react';
import { isPlatformError } from 'platform-bible-utils';
import { useCallback, useMemo, useState } from 'react';
import ContinuousScrollToggle from './ContinuousScrollToggle';
import { CreateProjectModal } from './CreateProjectModal';
import Interlinearizer from './Interlinearizer';
import { ProjectMetadataModal } from './ProjectMetadataModal';
import ScriptureNavControls from './ScriptureNavControls';
import {
  SelectInterlinearProjectModal,
  type InterlinearProjectSummary,
} from './SelectInterlinearProjectModal';
import useInterlinearizerBookData from '../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../hooks/useOptimisticBooleanSetting';

const STRING_KEYS: `%${string}%`[] = ['%interlinearizer_continuousScrollToggle%'];

/** Which modal is currently visible. Only one can be open at a time. */
type ModalState = 'none' | 'select' | 'create' | 'metadata';

/** Fields of the active interlinear project persisted in WebView state. */
type ActiveProjectState = Pick<
  InterlinearProjectSummary,
  'id' | 'createdAt' | 'name' | 'description' | 'sourceProjectId' | 'analysisWritingSystem'
>;

/**
 * Root component for loading the Interlinearizer. Loads book data and settings, manages modal state
 * for project creation/selection/metadata, then renders error and loading states or delegates to
 * {@link Interlinearizer} when data is ready.
 *
 * @param props - Component props
 * @param props.projectId - PAPI project ID passed from the host
 * @param props.useWebViewScrollGroupScrRef - Hook that exposes the shared scroll-group scripture
 *   reference and its setter
 * @param props.useWebViewState - Hook for reading and writing values persisted in the WebView's
 *   saved state (survives tab restores)
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

  const {
    isLoading: isSettingLoading,
    onChange: handleContinuousScrollChange,
    value: continuousScroll,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.continuousScroll', true);

  const { book, chapterSegments, isLoading, bookError, tokenizeError } = useInterlinearizerBookData(
    { projectId, scrRef },
  );

  const hasError = !!bookError || !!tokenizeError;
  const showLoading = isLoading || isSettingLoading;

  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);

  const [modal, setModal] = useState<ModalState>('none');

  /**
   * Persisted snapshot of the active interlinear project — kept in WebView state so it survives tab
   * restores. Updated after creation and when the user selects an existing project from the
   * picker.
   */
  const [activeProject, setActiveProject, resetActiveProject] = useWebViewState<
    ActiveProjectState | undefined
  >('activeProject', undefined);

  /**
   * The project currently open in the metadata modal. Set when the user clicks the info icon in the
   * select modal or triggers "View Project Info" from the menu.
   */
  const [metadataProject, setMetadataProject] = useState<InterlinearProjectSummary | undefined>(
    undefined,
  );

  /**
   * Tracks where the metadata modal was opened from so the correct modal is restored on close.
   * `'select'` means it was opened via the info icon in the select modal; `'menu'` means it was
   * opened via the "View Project Info" menu item.
   */
  const [metadataSource, setMetadataSource] = useState<'select' | 'menu'>('menu');

  /**
   * Tracks where the create modal was opened from so the correct modal is restored on close.
   * `'select'` means it was opened via "New Interlinear Project..." in the select modal; `'menu'`
   * means it was opened directly from the top menu.
   */
  const [createSource, setCreateSource] = useState<'select' | 'menu'>('menu');

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
        setCreateSource('menu');
        setModal('create');
      } else if (item.command === 'interlinearizer.openProjectInfoModal') {
        if (activeProject) {
          setMetadataProject(activeProject);
          setMetadataSource('menu');
          setModal('metadata');
        }
      }
    },
    [activeProject],
  );

  /**
   * Opens the metadata modal for the project whose info icon was clicked in the select modal.
   *
   * @param project - The project to display in the metadata modal.
   */
  const handleViewInfo = useCallback((project: InterlinearProjectSummary) => {
    setMetadataProject(project);
    setMetadataSource('select');
    setModal('metadata');
  }, []);

  /**
   * Records a newly created interlinear project as the active project.
   *
   * @param project - The full persisted project returned by the create command.
   */
  const handleProjectCreated = useCallback(
    (project: InterlinearProjectSummary) => {
      setActiveProject(project);
    },
    [setActiveProject],
  );

  /** Closes the create modal, returning to the select modal if creation was initiated from there. */
  const handleCreateModalClose = useCallback(() => {
    setModal(createSource === 'select' ? 'select' : 'none');
  }, [createSource]);

  /**
   * Called when the metadata modal saves changes. Updates `activeProject` state when the edited
   * project is the currently active one, then returns to the appropriate modal.
   *
   * @param updated - The updated name, description, and analysisWritingSystem.
   */
  const handleMetadataProjectSaved = useCallback(
    (updated: { name?: string; description?: string; analysisWritingSystem: string }) => {
      if (activeProject && metadataProject?.id === activeProject.id) {
        setActiveProject({ ...activeProject, ...updated });
      }
      setModal(metadataSource === 'select' ? 'select' : 'none');
      setMetadataProject(undefined);
    },
    [activeProject, metadataProject, metadataSource, setActiveProject],
  );

  /**
   * Called when the metadata modal deletes the project. Clears `activeProject` if it was the
   * deleted project, then returns to the appropriate modal.
   *
   * @param deletedId - UUID of the project that was deleted.
   */
  const handleMetadataProjectDeleted = useCallback(
    (deletedId: string) => {
      if (activeProject?.id === deletedId) resetActiveProject();
      setModal(metadataSource === 'select' ? 'select' : 'none');
      setMetadataProject(undefined);
    },
    [activeProject, metadataSource, resetActiveProject],
  );

  /**
   * Fetches the top-menu data for this WebView from the platform's menu data provider, hiding "View
   * Project Info" when no interlinear project is currently active.
   */
  const [webViewMenuPossiblyError] = useData(papi.menuData.dataProviderName).WebViewMenu(
    'interlinearizer.mainWebView',
    { topMenu: undefined, includeDefaults: true, contextMenu: undefined },
  );

  const projectMenuData = useMemo(() => {
    const menu =
      webViewMenuPossiblyError && !isPlatformError(webViewMenuPossiblyError)
        ? webViewMenuPossiblyError
        : { topMenu: undefined, includeDefaults: true, contextMenu: undefined };
    if (!menu.topMenu || activeProject) return menu.topMenu;
    const { items } = menu.topMenu;
    if (!Array.isArray(items)) return menu.topMenu;
    return {
      ...menu.topMenu,
      items: items.filter(
        (item) => !('command' in item) || item.command !== 'interlinearizer.openProjectInfoModal',
      ),
    };
  }, [webViewMenuPossiblyError, activeProject]);

  return (
    <div className="tw-flex tw-flex-col tw-h-full">
      <TabToolbar
        className="tw-z-10"
        projectMenuData={projectMenuData}
        startAreaChildren={
          <ScriptureNavControls
            scrRef={scrRef}
            handleSubmit={setScrRef}
            scrollGroupId={scrollGroupId}
            onChangeScrollGroupId={setScrollGroupId}
          />
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
        <div className="tw-flex tw-flex-col tw-gap-4 tw-p-4">
          {bookError && (
            <div className="tw-flex tw-flex-col tw-gap-2">
              <h2 className="tw-text-lg tw-font-medium tw-text-destructive">Error loading book</h2>
              <pre className="tw-overflow-auto tw-rounded-md tw-bg-muted tw-text-foreground tw-p-4 tw-text-sm">
                {bookError}
              </pre>
            </div>
          )}

          {tokenizeError && (
            <div className="tw-flex tw-flex-col tw-gap-2">
              <h2 className="tw-text-lg tw-font-medium tw-text-destructive">
                Error processing book
              </h2>
              <pre className="tw-overflow-auto tw-rounded-md tw-bg-muted tw-text-foreground tw-p-4 tw-text-sm">
                {tokenizeError.message}
              </pre>
            </div>
          )}

          {!hasError && showLoading && (
            <p className="tw-text-sm tw-text-muted-foreground">Loading…</p>
          )}
        </div>
      ) : (
        <Interlinearizer
          book={book}
          bookSegments={chapterSegments}
          continuousScroll={continuousScroll}
          scrRef={scrRef}
          setScrRef={setScrRef}
        />
      )}

      {modal === 'select' && (
        <SelectInterlinearProjectModal
          sourceProjectId={projectId}
          onSelect={(project) => {
            setActiveProject(project);
            setModal('none');
          }}
          onCreateNew={() => {
            setCreateSource('select');
            setModal('create');
          }}
          onClose={() => setModal('none')}
          onViewInfo={handleViewInfo}
        />
      )}

      {modal === 'create' && (
        <CreateProjectModal
          projectId={projectId}
          onClose={handleCreateModalClose}
          onProjectCreated={handleProjectCreated}
        />
      )}

      {modal === 'metadata' && metadataProject && (
        <ProjectMetadataModal
          interlinearProjectId={metadataProject.id}
          name={metadataProject.name}
          description={metadataProject.description}
          sourceProjectId={metadataProject.sourceProjectId}
          analysisWritingSystem={metadataProject.analysisWritingSystem}
          createdAt={metadataProject.createdAt}
          onClose={() => {
            setModal(metadataSource === 'select' ? 'select' : 'none');
            setMetadataProject(undefined);
          }}
          onProjectSaved={handleMetadataProjectSaved}
          onProjectDeleted={handleMetadataProjectDeleted}
        />
      )}
    </div>
  );
}
