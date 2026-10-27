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
 * Opens one watch per provider. Each opener gets a check that turns false once the watches are
 * closed. The opener drops any report that arrives after that. A report can arrive late: during
 * teardown, or from a watch that finishes subscribing after teardown.
 *
 * A provider whose watch cannot open contributes no reports.
 *
 * @returns Closes every watch, including any still opening.
 */
function watchEach(
  providers: readonly LexiconProvider[],
  open: (provider: LexiconProvider, isOpen: () => boolean) => Promise<UnsubscriberAsync>,
): () => void {
  let disposed = false;
  const isOpen = () => !disposed;
  const unsubscribers: UnsubscriberAsync[] = [];
  const close = (unsubscribe: UnsubscriberAsync) =>
    // Nothing acts on a watch this view has finished with, so a failure to close one is only
    // logged.
    unsubscribe().catch((e: unknown) => {
      logger.debug('Interlinearizer: a lexicon watch did not close', e);
    });

  providers.forEach((provider) => {
    (async () => {
      try {
        const unsubscribe = await open(provider, isOpen);
        if (disposed) await close(unsubscribe);
        else unsubscribers.push(unsubscribe);
      } catch {
        // The port treats unreachable software as ordinary, so a watch that rejects means the
        // provider is misbehaving. The provider's own code reports why. Here, the provider simply
        // goes unwatched.
      }
    })();
  });

  return () => {
    disposed = true;
    unsubscribers.forEach(close);
  };
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

  // Leaving a project closes its watches, so its link can change unobserved. A second visit reads
  // it fresh rather than reusing what the first visit saw.
  if (projectLinks.projectId !== projectId)
    setProjectLinks({ projectId, links: NO_LINKS, linksRead: NO_LINKS_READ });

  useEffect(
    () =>
      watchEach(PROVIDERS, (provider, isOpen) =>
        provider.subscribeToAvailability((available) => {
          if (!isOpen()) return;
          // An unchanged answer keeps the array it had, so a repeated report never tears down and
          // reopens the link watches keyed to it.
          setAvailableProviders((previous) => {
            const reached = new Set(previous);
            if (available) reached.add(provider);
            else reached.delete(provider);
            const next = PROVIDERS.filter((candidate) => reached.has(candidate));
            return sameProviders(previous, next) ? previous : next;
          });
        }),
      ),
    [],
  );

  useEffect(() => {
    if (availableProviders.length === 0) return undefined;

    const closeWatches = watchEach(availableProviders, (provider, isOpen) =>
      // A provider that cannot report a link contributes none, which is how a project with no
      // lexicon reads. It stays unread, though, so its chooser is not offered: a link that could not
      // be read may still be there to strand.
      provider.subscribeToLink(projectId, (lexiconId) => {
        if (!isOpen()) return;
        setProjectLinks((previous) => {
          // Leaving a project disposes its watches and drops its links, so only the project in view
          // can reach here.
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
      }),
    );

    return () => {
      closeWatches();
      // What these watches read goes unobserved from here, so a provider that is reached again
      // waits for its new watch to report rather than being offered on the old one's answer.
      setProjectLinks((previous) =>
        previous.projectId === projectId
          ? { projectId, links: NO_LINKS, linksRead: NO_LINKS_READ }
          : previous,
      );
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
