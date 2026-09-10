import type { LexiconAuthority } from 'interlinearizer';
import type { LexiconProvider } from 'interlinearizer/lexicon';
import { useEffect, useMemo, useState } from 'react';
import type { UnsubscriberAsync } from 'platform-bible-utils';
import { fwLiteLexiconProvider } from '../utils/fw-lite-lexicon';
import type { LexiconLinks, LexiconRegistry } from '../utils/lexicon-resolvers';
import { connectLexiconRegistry } from '../utils/lexicon-resolvers';

/**
 * The lexicon software a project can be linked to, in the order an affordance is offered from: the
 * first provider that can serve a capability is the one behind it.
 */
const PROVIDERS: readonly LexiconProvider[] = [fwLiteLexiconProvider];

/** Shared so a project with no link keeps one object identity across renders. */
const NO_LINKS: LexiconLinks = {};

/**
 * The one place the UI asks about the lexicon, so no component asks whether one particular lexicon
 * is connected.
 *
 * Answers for the project in view rather than for the session: a project is linked to one lexicon
 * per provider and more than one project can be open. Until the software has answered whether it
 * can be reached, the registry is the one that holds nothing, so a consumer renders the no-lexicon
 * shape rather than waiting on a lexicon that may not exist.
 *
 * Every provider is watched through one effect rather than one hook each, so the hooks this runs do
 * not vary with how many providers there are or which of them can be reached.
 */
export default function useLexiconRegistry(projectId: string): LexiconRegistry {
  const [availableProviders, setAvailableProviders] = useState<readonly LexiconProvider[]>([]);
  const [links, setLinks] = useState<LexiconLinks>(NO_LINKS);

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

  useEffect(() => {
    // The links of whichever project was in view before are not this project's, so they go before
    // the first watch answers rather than after.
    setLinks(NO_LINKS);
    if (availableProviders.length === 0) return undefined;

    // Guards the state updates alone: a watch reports the current link as soon as it subscribes, so
    // a callback can still land around teardown. Unsubscribing is handled by `disposed` below,
    // which also covers a watch that finishes subscribing after teardown.
    let disposed = false;
    const unsubscribers: UnsubscriberAsync[] = [];

    availableProviders.forEach((provider) => {
      (async () => {
        try {
          const unsubscribe = await provider.subscribeToLink(projectId, (lexiconId) => {
            if (disposed) return;
            setLinks((previous) => {
              if (previous[provider.authority] === lexiconId) return previous;
              const next: Record<LexiconAuthority, string> = { ...previous };
              if (lexiconId) next[provider.authority] = lexiconId;
              else delete next[provider.authority];
              return next;
            });
          });
          if (disposed) await unsubscribe();
          else unsubscribers.push(unsubscribe);
        } catch {
          // A provider that cannot report a link contributes none, which is how a project with no
          // lexicon reads. Its own watch says why; there is nothing to add here.
        }
      })();
    });

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => {
        unsubscribe();
      });
    };
  }, [availableProviders, projectId]);

  return useMemo(
    () => connectLexiconRegistry(availableProviders, links),
    [availableProviders, links],
  );
}
