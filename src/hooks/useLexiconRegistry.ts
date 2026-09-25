import { logger } from '@papi/frontend';
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

/** Shared so a project whose links are all unread keeps one object identity across renders. */
const NO_LINKS_READ: ReadonlySet<LexiconAuthority> = new Set();

/**
 * The links read so far, which providers have reported one at all, and the project they were read
 * for. Kept together so a project that has just come into view is never paired with the links of
 * the one before it.
 */
type ProjectLinks = {
  projectId: string;
  links: LexiconLinks;
  linksRead: ReadonlySet<LexiconAuthority>;
};

/** Whether two answers name the same software in the same order. */
function sameProviders(a: readonly LexiconProvider[], b: readonly LexiconProvider[]): boolean {
  return a.length === b.length && a.every((provider, index) => provider === b[index]);
}

/**
 * The one place the UI asks about the lexicon, so no component asks whether one particular lexicon
 * is connected.
 *
 * Answers for the project in view: a project is linked to one lexicon per provider, and more than
 * one project can be open. Until the software has answered whether it can be reached, the registry
 * is the one that holds nothing, so a consumer renders the no-lexicon shape rather than waiting on
 * a lexicon that may not exist.
 */
export default function useLexiconRegistry(projectId: string): LexiconRegistry {
  const [availableProviders, setAvailableProviders] = useState<readonly LexiconProvider[]>([]);
  const [projectLinks, setProjectLinks] = useState<ProjectLinks>({
    projectId,
    links: NO_LINKS,
    linksRead: NO_LINKS_READ,
  });
  const [availabilityProbe, setAvailabilityProbe] = useState(0);

  // Leaving a project closes its watches, so its link can change unobserved. A second visit reads
  // it fresh rather than reusing what the first visit saw.
  if (projectLinks.projectId !== projectId)
    setProjectLinks({ projectId, links: NO_LINKS, linksRead: NO_LINKS_READ });

  // A provider answers whether it can be reached once, so software that registers after the first
  // answer (an activation slower than the provider's wait, or the Lexicon extension installed while
  // this view is open) would stay invisible for the life of the view. Asking again whenever focus
  // moves into the view notices it; a user who never leaves the view is not re-asked.
  useEffect(() => {
    const probeAgain = () => setAvailabilityProbe((count) => count + 1);
    window.addEventListener('focus', probeAgain);
    return () => window.removeEventListener('focus', probeAgain);
  }, []);

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
      const available = answers.flatMap((answer) =>
        answer.status === 'fulfilled' && answer.value.available ? [answer.value.provider] : [],
      );
      // An unchanged answer keeps the array it had, so re-asking never tears down and reopens the
      // link watches keyed to it.
      setAvailableProviders((previous) =>
        sameProviders(previous, available) ? previous : available,
      );
    })();
    return () => {
      ignore = true;
    };
  }, [availabilityProbe]);

  useEffect(() => {
    if (availableProviders.length === 0) return undefined;

    // A watch reports the current link as soon as it subscribes, so a callback can still land
    // around teardown. This also covers a watch that finishes subscribing after teardown.
    let disposed = false;
    const unsubscribers: UnsubscriberAsync[] = [];

    availableProviders.forEach((provider) => {
      (async () => {
        try {
          const unsubscribe = await provider.subscribeToLink(projectId, (lexiconId) => {
            if (disposed) return;
            setProjectLinks((previous) => {
              // Leaving a project disposes its watches and drops its links, so only the project in
              // view can reach here.
              const alreadyRead = previous.linksRead.has(provider.authority);
              if (alreadyRead && previous.links[provider.authority] === lexiconId) return previous;
              const next: Record<LexiconAuthority, string> = { ...previous.links };
              if (lexiconId) next[provider.authority] = lexiconId;
              else delete next[provider.authority];
              const linksRead = alreadyRead
                ? previous.linksRead
                : new Set([...previous.linksRead, provider.authority]);
              return { projectId, links: next, linksRead };
            });
          });
          if (disposed) await unsubscribe();
          else unsubscribers.push(unsubscribe);
        } catch {
          // A provider that cannot report a link contributes none, which is how a project with no
          // lexicon reads. It stays unread, though, so its chooser is not offered: a link that could
          // not be read may still be there to strand. Its own watch reports why.
        }
      })();
    });

    return () => {
      disposed = true;
      // What these watches read goes unobserved from here, so a provider that is reached again
      // waits for its new watch to report rather than being offered on the old one's answer.
      setProjectLinks((previous) =>
        previous.projectId === projectId
          ? { projectId, links: NO_LINKS, linksRead: NO_LINKS_READ }
          : previous,
      );
      unsubscribers.forEach((unsubscribe) => {
        // A watch this view has finished with is nothing it can act on, so a failure to close one
        // is only worth saying out loud.
        unsubscribe().catch((e: unknown) => {
          logger.debug('Interlinearizer: a lexicon link watch did not close', e);
        });
      });
    };
  }, [availableProviders, projectId]);

  // Checked on the way out rather than in an effect, which would run after the render that would
  // have used another project's links.
  const isCurrent = projectLinks.projectId === projectId;
  const links = isCurrent ? projectLinks.links : NO_LINKS;
  const linksRead = isCurrent ? projectLinks.linksRead : NO_LINKS_READ;

  return useMemo(
    () => connectLexiconRegistry(projectId, availableProviders, links, linksRead),
    [projectId, availableProviders, links, linksRead],
  );
}
