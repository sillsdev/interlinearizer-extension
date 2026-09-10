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
 * The links read so far, and the project they were read for. Kept together so a project that has
 * just come into view is never paired with the links of the one before it: the pairing is checked
 * on the way out, rather than corrected by an effect that runs after the render is on screen.
 */
type ProjectLinks = { projectId: string; links: LexiconLinks };

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
  const [projectLinks, setProjectLinks] = useState<ProjectLinks>({ projectId, links: NO_LINKS });

  useEffect(() => {
    let ignore = false;
    (async () => {
      // A provider that rejects rather than answering `false` is misbehaving, since the port says
      // unavailability is ordinary. Settle each answer on its own, so that one cannot leave every
      // other provider unreachable.
      const answers = await Promise.allSettled(
        PROVIDERS.map(async (provider) => ({ provider, available: await provider.isAvailable() })),
      );
      if (ignore) return;
      setAvailableProviders(
        answers.flatMap((answer) =>
          answer.status === 'fulfilled' && answer.value.available ? [answer.value.provider] : [],
        ),
      );
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
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
            setProjectLinks((previous) => {
              // A watch answers only for the project it subscribed to, so an answer that arrives
              // once another project is in view starts that project's links rather than joining
              // links read for the one before it.
              const sameProject = previous.projectId === projectId;
              if (sameProject && previous.links[provider.authority] === lexiconId) return previous;
              const next: Record<LexiconAuthority, string> = {
                ...(sameProject ? previous.links : NO_LINKS),
              };
              if (lexiconId) next[provider.authority] = lexiconId;
              else delete next[provider.authority];
              return { projectId, links: next };
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

  // Links read for another project name none of this one's lexicons, so they are dropped on the way
  // out rather than by an effect - an effect runs after the render that would have used them.
  const links = projectLinks.projectId === projectId ? projectLinks.links : NO_LINKS;

  return useMemo(
    () => connectLexiconRegistry(availableProviders, links),
    [availableProviders, links],
  );
}
