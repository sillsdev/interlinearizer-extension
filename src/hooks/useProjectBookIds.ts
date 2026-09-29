import { useProjectSetting } from '@papi/frontend/react';
import { isPlatformError } from 'platform-bible-utils';
import { getBookIdsFromBooksPresent } from 'platform-bible-utils/experimental';
import { useMemo } from 'react';

/** The books a Scripture project contains. */
export type ProjectBookIds = {
  /**
   * The project's book ids in canonical order, or `undefined` while the list is loading or when the
   * platform could not supply it.
   */
  bookIds: string[] | undefined;
  /** Whether the list is still being fetched, as opposed to having failed. */
  isLoading: boolean;
};

/** Lists the books a Scripture project contains. */
export default function useProjectBookIds(projectId: string): ProjectBookIds {
  const [booksPresent, , , isLoading] = useProjectSetting(
    projectId,
    'platformScripture.booksPresent',
    '',
  );

  const bookIds = useMemo(
    () =>
      !booksPresent || isPlatformError(booksPresent)
        ? undefined
        : getBookIdsFromBooksPresent(booksPresent),
    [booksPresent],
  );

  return { bookIds, isLoading };
}
