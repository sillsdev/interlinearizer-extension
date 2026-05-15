import type { UseWebViewScrollGroupScrRefHook } from '@papi/core';
import papi, { logger } from '@papi/frontend';
import { useData, useLocalizedStrings } from '@papi/frontend/react';
import { isPlatformError } from 'platform-bible-utils';
import type { SelectMenuItemHandler } from 'platform-bible-react';
import { TabToolbar } from 'platform-bible-react';
import { useCallback, useMemo, useState } from 'react';
import ContinuousScrollToggle from './ContinuousScrollToggle';
import Interlinearizer from './Interlinearizer';
import ScriptureNavControls from './ScriptureNavControls';
import useInterlinearizerBookData from '../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../hooks/useOptimisticBooleanSetting';

/** Localization keys fetched from the platform for this component's UI strings. */
const STRING_KEYS = ['%interlinearizer_continuousScrollToggle%'] as const;

/** Command name for the retokenize project menu item. */
const RETOKENIZE_COMMAND = 'interlinearizer.retokenize' as const;

/**
 * Root component for loading the Interlinearizer. Loads book data and settings, then renders error
 * and loading states or delegates to {@link Interlinearizer} when data is ready.
 *
 * @param props - Component props
 * @param props.projectId - PAPI project ID passed from the host
 * @param props.useWebViewScrollGroupScrRef - Hook that exposes the shared scroll-group scripture
 *   reference and its setter
 */
export default function InterlinearizerLoader({
  projectId,
  useWebViewScrollGroupScrRef,
}: Readonly<{
  projectId: string;
  useWebViewScrollGroupScrRef: UseWebViewScrollGroupScrRefHook;
}>) {
  const [scrRef, setScrRef, scrollGroupId, setScrollGroupId] = useWebViewScrollGroupScrRef();

  const {
    isLoading: isSettingLoading,
    onChange: handleContinuousScrollChange,
    value: continuousScroll,
  } = useOptimisticBooleanSetting(projectId, 'interlinearizer.continuousScroll', true);

  const [retokenizeKey, setRetokenizeKey] = useState(0);

  const { book, chapterSegments, isLoading, bookError, tokenizeError } = useInterlinearizerBookData(
    {
      projectId,
      scrRef,
      retokenizeKey,
    },
  );

  const hasError = !!bookError || !!tokenizeError;
  const showLoading = isLoading || isSettingLoading;

  const [localizedStrings] = useLocalizedStrings(useMemo(() => [...STRING_KEYS], []));

  /** Fetches the top-menu data for this WebView from the platform's menu data provider. */
  const [webViewMenuPossiblyError] = useData(papi.menuData.dataProviderName).WebViewMenu(
    'interlinearizer.mainWebView',
    { topMenu: undefined, includeDefaults: true, contextMenu: undefined },
  );

  const projectMenuData = useMemo(() => {
    if (!webViewMenuPossiblyError || isPlatformError(webViewMenuPossiblyError)) return undefined;
    return webViewMenuPossiblyError.topMenu;
  }, [webViewMenuPossiblyError]);

  /**
   * Handles project menu item selections from the toolbar. Dispatches known command names to the
   * appropriate local action; unknown commands are silently ignored.
   *
   * @param selectedMenuItem - The menu item that was selected.
   * @param selectedMenuItem.command - The command name string registered in `menus.json`.
   */
  const handleSelectProjectMenuItem = useCallback<SelectMenuItemHandler>(({ command }) => {
    if (command === RETOKENIZE_COMMAND) setRetokenizeKey((k) => k + 1);
  }, []);

  const toolbar = (
    <TabToolbar
      className="tw:z-10"
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
      onSelectProjectMenuItem={handleSelectProjectMenuItem}
      projectMenuData={projectMenuData}
      /* v8 ignore next 3 -- stub required by TabToolbar API, no behaviour to test */
      onSelectViewInfoMenuItem={() => {
        logger.warn('Interlinearizer: unexpected onSelectViewInfoMenuItem call');
      }}
    />
  );

  return (
    <div className="tw:flex tw:flex-col tw:h-full">
      {toolbar}

      {hasError || showLoading || !book ? (
        <div className="tw:flex tw:flex-col tw:gap-4 tw:p-4">
          {bookError && (
            <div className="tw:flex tw:flex-col tw:gap-2">
              <h2 className="tw:text-lg tw:font-medium tw:text-destructive">Error loading book</h2>
              <pre className="tw:overflow-auto tw:rounded-md tw:bg-muted tw:p-4 tw:text-sm">
                {bookError}
              </pre>
            </div>
          )}

          {tokenizeError && (
            <div className="tw:flex tw:flex-col tw:gap-2">
              <h2 className="tw:text-lg tw:font-medium tw:text-destructive">
                Error processing book
              </h2>
              <pre className="tw:overflow-auto tw:rounded-md tw:bg-muted tw:p-4 tw:text-sm">
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
    </div>
  );
}
