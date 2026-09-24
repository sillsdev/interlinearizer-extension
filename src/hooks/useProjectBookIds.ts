import { useProjectSetting } from '@papi/frontend/react';
import { isPlatformError } from 'platform-bible-utils';
import { getBookIdsFromBooksPresent } from 'platform-bible-utils/experimental';
import { useMemo } from 'react';

/**
 * Lists the books a Scripture project contains.
 *
 * @returns The project's book ids in canonical order, or `undefined` while the list is loading or
 *   when the platform could not supply it.
 */
export default function useProjectBookIds(projectId: string): string[] | undefined {
  const [booksPresent] = useProjectSetting(projectId, 'platformScripture.booksPresent', '');

  return useMemo(
    () =>
      !booksPresent || isPlatformError(booksPresent)
        ? undefined
        : getBookIdsFromBooksPresent(booksPresent),
    [booksPresent],
  );
}
