import type { UseWebViewScrollGroupScrRefHook, UseWebViewStateHook } from '@papi/core';
import papi, { logger } from '@papi/frontend';
import { useData, useLocalizedStrings, useSetting } from '@papi/frontend/react';
import { TabToolbar } from 'platform-bible-react';
import type { SelectMenuItemHandler } from 'platform-bible-react';
import { isPlatformError } from 'platform-bible-utils';
import { useCallback, useMemo, useState } from 'react';
import useInterlinearizerBookData from '../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../hooks/useOptimisticBooleanSetting';
import ContinuousScrollToggle from './ContinuousScrollToggle';
import Interlinearizer from './Interlinearizer';
import ProjectModals, { type ModalState } from './ProjectModals';
import ScriptureNavControls from './ScriptureNavControls';
import type { ActiveProjectState } from './SelectInterlinearProjectModal';

const STRING_KEYS: `%${string}%`[] = ['%interlinearizer_continuousScrollToggle%'];

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

  const [interfaceMode] = useSetting('platform.interfaceMode', 'simple');

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
  const [activeProject] = useWebViewState<ActiveProjectState | undefined>(
    'activeProject',
    undefined,
  );

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
          book={book}
          bookSegments={chapterSegments}
          continuousScroll={continuousScroll}
          scrRef={scrRef}
          setScrRef={setScrRef}
        />
      )}

      <ProjectModals
        activeProject={activeProject}
        modal={modal}
        projectId={projectId}
        setModal={setModal}
        useWebViewState={useWebViewState}
      />
    </div>
  );
}
