import papi, { logger } from '@papi/frontend';
import type {
  LexiconProvider,
  LexiconResolver,
  ResolvedSense,
  SenseCandidate,
} from 'interlinearizer/lexicon';
import type { UnsubscriberAsync } from 'platform-bible-utils';
import type { LexiconEntry, LexiconEntryService, LexiconSense } from '../types/lexicon-extension';
import { FW_LITE_AUTHORITY } from './lexicon-authorities';
import { foldForSearch } from './search-fold';

/** Id of the Lexicon extension's network service, the only way in to FieldWorks Lite. */
const ENTRY_SERVICE_ID = 'lexicon.entryService';

/**
 * The Lexicon extension's project setting naming the lexicon a project is linked to. That extension
 * owns and writes it.
 */
const LEXICON_CODE_SETTING = 'lexicon.lexiconCode';

/** Answers a watch that can never fire, for a project whose link cannot be read. */
const NO_LINK_UNSUBSCRIBER: UnsubscriberAsync = async () => true;

/**
 * How long to wait for the Lexicon extension's service before FieldWorks Lite counts as absent.
 * Generous, since nothing orders that extension's activation before this one's.
 */
const AVAILABILITY_TIMEOUT_MS = 10_000;

/**
 * Cached once found, so a session pays the wait once rather than once per connection.
 *
 * Dropped when the Lexicon extension disposes it: the proxy is revoked then, so a call on the old
 * one throws rather than missing.
 */
let entryService: LexiconEntryService | undefined;

/**
 * The look-up in flight, so a caller arriving during one waits on that rather than on a wait of its
 * own. Nothing is held once it settles: a look-up that found the service leaves it cached, and one
 * that found none is started afresh by the next call.
 */
let entryServiceLookup: Promise<LexiconEntryService | undefined> | undefined;

/** Waits for the entry service to be registered, and caches it until it is disposed. */
async function lookUpEntryService(): Promise<LexiconEntryService | undefined> {
  try {
    await papi.networkObjectStatus.waitForNetworkObject(
      { id: ENTRY_SERVICE_ID },
      AVAILABILITY_TIMEOUT_MS,
    );
    const service = await papi.networkObjects.get<LexiconEntryService>(ENTRY_SERVICE_ID);
    // The proxy is revoked as soon as these handlers return, so this one only drops the reference:
    // anything it awaited first would be acting on a dead proxy.
    service?.onDidDispose(() => {
      entryService = undefined;
    });
    entryService = service;
  } catch (e) {
    logger.debug('Interlinearizer: the lexicon entry service is unavailable', e);
  }
  return entryService;
}

/**
 * Reaches the Lexicon extension's entry service, waiting for it to be registered in case that
 * extension has not finished activating.
 *
 * @returns The service, or `undefined` when nothing registers it in time - the shape of running
 *   without FieldWorks Lite installed.
 */
async function getEntryService(): Promise<LexiconEntryService | undefined> {
  if (entryService) return entryService;
  entryServiceLookup ??= lookUpEntryService().finally(() => {
    entryServiceLookup = undefined;
  });
  return entryServiceLookup;
}

/** Discards what a session has found so the next look-up starts over. */
export function resetEntryServiceForTesting(): void {
  entryService = undefined;
  entryServiceLookup = undefined;
}

/**
 * Maps a lexicon sense to what the Interlinearizer displays. Only the gloss carries over:
 * FieldWorks Lite holds a definition as rich text and does not label senses, so neither has a plain
 * form to carry over yet.
 *
 * A sense carrying no gloss is glossed with nothing rather than with `undefined` dressed as a
 * `MultiString` (which would render as nothing with no clue why). These records are declared with
 * their glosses, forms, and senses required, but they arrive from another extension over PAPI,
 * which enforces nothing, so every read of one defends itself.
 */
function toResolvedSense(sense: LexiconSense): ResolvedSense {
  return { gloss: sense.gloss ?? {} };
}

/**
 * Whether `entry` is listed under a form in `writingSystem` that `form` matches.
 *
 * Matching ignores whatever the search fold ignores, so a match the lexicon made on a pointed or
 * accented form survives rather than being dropped for not being spelled the way it was queried.
 *
 * This can only narrow what the lexicon matched. A candidate it matched by something the fold does
 * not reach is dropped, which is the cost of there being no writing system to search in.
 */
function matchesInWritingSystem(entry: LexiconEntry, form: string, writingSystem: string): boolean {
  const lexemeForm = (entry.lexemeForm ?? {})[writingSystem];
  return lexemeForm !== undefined && foldForSearch(lexemeForm).includes(foldForSearch(form));
}

/**
 * Names every sense of `entry` for linking, alongside the form the entry is listed under. An entry
 * carrying no senses names none, so it offers nothing to link a gloss to and drops out of a
 * search.
 */
function toCandidates(entry: LexiconEntry, lexiconCode: string): SenseCandidate[] {
  return (entry.senses ?? []).map((sense) => ({
    ...toResolvedSense(sense),
    lexemeForm: entry.lexemeForm,
    ref: { authority: FW_LITE_AUTHORITY, projectId: lexiconCode, senseId: sense.id },
  }));
}

/**
 * One connection to one FieldWorks Lite lexicon, or to none.
 *
 * With no lexicon connected the resolver offers no capability, so nothing invites the user to
 * search or add to a lexicon that is not there.
 */
function createResolver(lexiconCode?: string): LexiconResolver {
  const connected = !!lexiconCode;
  return {
    authorities: [FW_LITE_AUTHORITY],
    capabilities: {
      search: connected,
      create: connected,
      // FW Lite's model, MiniLcm, records neither.
      allomorphs: false,
      msas: false,
    },

    resolveSense: async (ref) => {
      // The connected lexicon is the only one this resolver answers for, so a ref naming another
      // misses whether or not that lexicon exists.
      if (!lexiconCode || ref.projectId !== lexiconCode) return undefined;
      const sense = await (await getEntryService())?.getSense(lexiconCode, ref.senseId);
      return sense ? toResolvedSense(sense) : undefined;
    },

    searchByForm: async (form, options) => {
      if (!lexiconCode) return [];
      const entries =
        (await (await getEntryService())?.getEntries(lexiconCode, { surfaceForm: form })) ?? [];
      // The backend searches every writing system it holds forms in, and cannot be told to search
      // just one, so `writingSystem` narrows the results here instead. Holding a form in that
      // writing system does not make an entry a match: the backend may have matched it on another
      // language's form, or on a gloss.
      const writingSystem = options?.writingSystem;
      const candidates = entries
        .filter((entry) => !writingSystem || matchesInWritingSystem(entry, form, writingSystem))
        .flatMap((entry) => toCandidates(entry, lexiconCode));
      // Clamped, since a negative end offset would trim candidates off the end rather than cap
      // them: a caller asking for at most -1 gets none, not all but one.
      return options?.limit === undefined
        ? candidates
        : candidates.slice(0, Math.max(0, options.limit));
    },

    createEntry: async (draft) => {
      if (!lexiconCode) throw new Error('No lexicon is connected to create an entry in.');
      const service = await getEntryService();
      if (!service) throw new Error('The lexicon is unreachable, so no entry was created.');

      // One sense always, gloss or none: a created entry is only useful here if a gloss can link to
      // a sense of it.
      const entry = await service.addEntry(lexiconCode, {
        lexemeForm: { [draft.writingSystem]: draft.form },
        senses: [{ gloss: draft.gloss ?? {} }],
      });
      const senseId = entry?.senses?.[0]?.id;
      if (!entry || !senseId) {
        throw new Error('The lexicon reported no entry and sense to link a gloss to.');
      }
      return {
        entryRef: { authority: FW_LITE_AUTHORITY, projectId: lexiconCode, entryId: entry.id },
        senseRef: { authority: FW_LITE_AUTHORITY, projectId: lexiconCode, senseId },
      };
    },
  };
}

/**
 * Watches the Lexicon extension's record of which lexicon this project is linked to.
 *
 * Reading that extension's setting rather than keeping a copy is what keeps the two extensions on
 * one lexicon per project: a lexicon chosen in either is the lexicon both use, and clearing it
 * unlinks both.
 */
async function subscribeToLink(
  projectId: string,
  callback: (lexiconId: string | undefined) => void,
): Promise<UnsubscriberAsync> {
  try {
    const projectDataProvider = await papi.projectDataProviders.get('platform.base', projectId);
    return await projectDataProvider.subscribeSetting(LEXICON_CODE_SETTING, (value) => {
      // A `PlatformError` arrives in place of the value where the setting cannot be read, and an
      // empty string is how a project drops its link; both are no link.
      callback(typeof value === 'string' && value ? value : undefined);
    });
  } catch (e) {
    // The Lexicon extension contributes this setting, so a project that cannot serve it is a
    // project with no FieldWorks Lite lexicon - the shape of running without that extension.
    logger.debug(`Interlinearizer: no lexicon link for project '${projectId}'`, e);
    callback(undefined);
    return NO_LINK_UNSUBSCRIBER;
  }
}

/** FieldWorks Lite, reached through the Lexicon extension. */
export const fwLiteLexiconProvider: LexiconProvider = {
  authority: FW_LITE_AUTHORITY,
  isAvailable: async () => (await getEntryService()) !== undefined,
  subscribeToLink,
  connect: createResolver,
};
