import { useProjectSetting } from '@papi/frontend/react';
import type { LexiconLink, LexiconProvider } from 'interlinearizer/lexicon';
import { useEffect, useMemo, useState } from 'react';
import { fwLiteLexiconProvider } from '../utils/fw-lite-lexicon';
import type { LexiconRegistry } from '../utils/lexicon-resolvers';
import { connectLexiconRegistry } from '../utils/lexicon-resolvers';

/** The lexicon software a project can be linked to. */
const PROVIDERS: readonly LexiconProvider[] = [fwLiteLexiconProvider];

/** Reads a project setting as a string, treating a platform error or a pending load as unset. */
function asSetting(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The one place the UI asks about the lexicon, so no component asks whether one particular lexicon
 * is connected.
 *
 * Answers for the project in view rather than for the session: a project is linked to one lexicon
 * and more than one project can be open. Until the software has answered whether it can be reached,
 * the registry is the one that holds nothing, so a consumer renders the no-lexicon shape rather
 * than waiting on a lexicon that may not exist.
 */
export default function useLexiconRegistry(projectId: string): LexiconRegistry {
  const [storedAuthority] = useProjectSetting(projectId, 'interlinearizer.lexiconAuthority', '');
  const [storedLexiconCode] = useProjectSetting(projectId, 'interlinearizer.lexiconCode', '');
  const [availableProviders, setAvailableProviders] = useState<readonly LexiconProvider[]>([]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const availability = await Promise.all(PROVIDERS.map((provider) => provider.isAvailable()));
      if (!ignore) setAvailableProviders(PROVIDERS.filter((_, index) => availability[index]));
    })();
    return () => {
      ignore = true;
    };
  }, []);

  // Half a link names no lexicon, so either half missing leaves the project glossing without one.
  // That is also how a user drops a link: clearing the lexicon code in the project settings.
  const link = useMemo<LexiconLink | undefined>(() => {
    const authority = asSetting(storedAuthority);
    const lexiconId = asSetting(storedLexiconCode);
    return authority && lexiconId ? { authority, lexiconId } : undefined;
  }, [storedAuthority, storedLexiconCode]);

  return useMemo(
    () => connectLexiconRegistry(availableProviders, link),
    [availableProviders, link],
  );
}
