import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from 'platform-bible-react';

const STRING_KEYS = [
  '%interlinearizer_duplicateTab_title%',
  '%interlinearizer_duplicateTab_description%',
  '%interlinearizer_duplicateTab_goToTab%',
] as const satisfies `%${string}%`[];

/**
 * Stands in for the interlinear view when a restored layout opens a second tab on a project that
 * another tab already shows. Offers to go to the other tab.
 */
export default function DuplicateTabNotice({
  webViewId,
}: Readonly<{
  /** This tab's id, from which the host finds the tab that already shows the same project. */
  webViewId: string;
}>) {
  const [localizedStrings, isStringsLoading] = useLocalizedStrings(STRING_KEYS);
  if (isStringsLoading) return undefined;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{localizedStrings['%interlinearizer_duplicateTab_title%']}</EmptyTitle>
        <EmptyDescription>
          {localizedStrings['%interlinearizer_duplicateTab_description%']}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          onClick={() =>
            papi.commands
              .sendCommand('interlinearizer.openForWebView', webViewId)
              .catch((e) => logger.warn('Interlinearizer: could not go to the open tab', e))
          }
        >
          {localizedStrings['%interlinearizer_duplicateTab_goToTab%']}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
