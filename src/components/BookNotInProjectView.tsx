import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings, useProjectSetting } from '@papi/frontend/react';
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyState,
  EmptyTitle,
} from 'platform-bible-react';
import { formatReplacementString, isPlatformError } from 'platform-bible-utils';
import { useEffect } from 'react';

const STRING_KEYS = [
  '%interlinearizer_bookNotInProject_title%',
  '%interlinearizer_bookNotInProject_description%',
  '%interlinearizer_bookNotInProject_manageBooks%',
  '%interlinearizer_bookNotInProject_askAdministrator%',
  '%interlinearizer_bookNotInResource%',
  '%interlinearizer_bookNotInProject_unknownProjectType%',
] as const satisfies `%${string}%`[];

/** Opens the platform's Manage Books dialog ready to create the book this web view is on. */
function openManageBooks(webViewId: string): void {
  papi.commands
    .sendCommand('platformScripture.openManageBooks', webViewId, 'createMissingBook')
    .catch((e) => {
      logger.warn(`Interlinearizer: could not open Manage Books: ${e}`);
      return papi.notifications.send({
        message: '%interlinearizer_error_openManageBooks%',
        severity: 'error',
      });
    })
    /* v8 ignore next -- a failed notification has nowhere left to report to */
    .catch(() => {});
}

/**
 * Stands in for the interlinear view when the source project lacks the book being navigated to.
 * Power mode offers to create the book through Manage Books; Simple mode and resources, where the
 * user cannot add books, get a message only, as does a project whose type cannot be read.
 */
export default function BookNotInProjectView({
  projectId,
  webViewId,
  isPowerMode,
}: Readonly<{
  /** Source project the book is missing from. */
  projectId: string;
  /** Web view whose project and current book Manage Books opens on. */
  webViewId: string;
  isPowerMode: boolean;
}>) {
  const [localizedStrings, isStringsLoading] = useLocalizedStrings(STRING_KEYS);
  const [isPublished, , , isPublishedLoading] = useProjectSetting(
    projectId,
    'platform.isPublished',
    false,
  );

  useEffect(() => {
    if (isPlatformError(isPublished))
      logger.warn(
        `Interlinearizer: could not tell whether ${projectId} is a resource: ${isPublished.message}`,
      );
  }, [isPublished, projectId]);

  // Until both resolve, any message could be the wrong one.
  if (isStringsLoading || isPublishedLoading) return undefined;

  if (isPlatformError(isPublished))
    return (
      <EmptyState
        message={localizedStrings['%interlinearizer_bookNotInProject_unknownProjectType%']}
      />
    );

  if (isPublished === true)
    return <EmptyState message={localizedStrings['%interlinearizer_bookNotInResource%']} />;

  if (!isPowerMode)
    return (
      <EmptyState
        message={localizedStrings['%interlinearizer_bookNotInProject_askAdministrator%']}
      />
    );

  const buttonLabel = localizedStrings['%interlinearizer_bookNotInProject_manageBooks%'];
  return (
    <Empty role="status">
      <EmptyHeader>
        <EmptyTitle>
          <h2>{localizedStrings['%interlinearizer_bookNotInProject_title%']}</h2>
        </EmptyTitle>
        <EmptyDescription>
          {formatReplacementString(
            localizedStrings['%interlinearizer_bookNotInProject_description%'],
            { buttonLabel },
          )}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => openManageBooks(webViewId)}>{buttonLabel}</Button>
      </EmptyContent>
    </Empty>
  );
}
