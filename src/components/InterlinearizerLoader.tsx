import type { UseWebViewScrollGroupScrRefHook } from '@papi/core';
import { useLocalizedStrings } from '@papi/frontend/react';
import type { Localized, MultiColumnMenu } from 'platform-bible-utils';
import type { SelectMenuItemHandler } from 'platform-bible-react';
import { TabToolbar } from 'platform-bible-react';
import { useCallback, useMemo, useState } from 'react';
import ContinuousScrollToggle from './ContinuousScrollToggle';
import Interlinearizer from './Interlinearizer';
import ScriptureNavControls from './ScriptureNavControls';
import useInterlinearizerBookData from '../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../hooks/useOptimisticBooleanSetting';

/** Localization keys fetched from the platform for this component's UI strings. */
const STRING_KEYS = [
  '%interlinearizer_continuousScrollToggle%',
  '%interlinearizer_retokenize%',
] as const;

/** Command name for the retokenize project menu item. */
const RETOKENIZE_COMMAND = 'interlinearizer.retokenize' as const;

/** Structural shell of the project menu; label is filled in at render time from localized strings. */
const PROJECT_MENU_SHELL = {
  columns: { 'interlinearizer.projectData.column': { order: 1, label: '' } },
  groups: {
    'interlinearizer.projectData': {
      column: 'interlinearizer.projectData.column',
      order: 1,
    },
  },
} as const satisfies Omit<Localized<MultiColumnMenu>, 'items'>;

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

  const projectMenuData = useMemo<Localized<MultiColumnMenu>>(
    () => ({
      ...PROJECT_MENU_SHELL,
      items: [
        {
          command: RETOKENIZE_COMMAND,
          group: 'interlinearizer.projectData',
          label: localizedStrings['%interlinearizer_retokenize%'] ?? '',
          localizeNotes: 'Project data menu > re-run tokenization from the latest USJ',
          order: 1,
        },
      ],
    }),
    [localizedStrings],
  );

  /**
   * Handles project menu item selections from the toolbar. Dispatches known command names to the
   * appropriate local action; unknown commands are silently ignored.
   *
   * @param selectedMenuItem - The menu item that was selected.
   * @param selectedMenuItem.command - The command name string from {@link PROJECT_MENU_SHELL}.
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
      /* v8 ignore next -- stub required by TabToolbar API, no behaviour to test */
      onSelectViewInfoMenuItem={() => {}}
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
