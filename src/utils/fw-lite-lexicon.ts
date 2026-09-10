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

/** Id of the Lexicon extension's network service, the only way in to FieldWorks Lite. */
const ENTRY_SERVICE_ID = 'lexicon.entryService';

/**
 * The Lexicon extension's project setting naming the lexicon a project is linked to. That extension
 * owns and writes it, and reads it back for its own lexicon actions, so both extensions reach one
 * lexicon per project and nothing here can disagree with it.
 */
const LEXICON_CODE_SETTING = 'lexicon.lexiconCode';

/** Answers a watch that can never fire, for a project whose link cannot be read. */
const NO_LINK_UNSUBSCRIBER: UnsubscriberAsync = async () => true;

/**
 * How long the Lexicon extension is given to register its service before FieldWorks Lite counts as
 * absent. Long enough to cover that extension activating after this one, since activation is not
 * ordered by dependency.
 */
const AVAILABILITY_TIMEOUT_MS = 10_000;

/** Cached once found, so a session pays the wait once rather than per connection. */
let entryService: LexiconEntryService | undefined;

/**
 * Reaches the Lexicon extension's entry service, waiting for it to be registered in case that
 * extension has not finished activating.
 *
 * @returns The service, or `undefined` when nothing registers it in time - the shape of running
 *   without FieldWorks Lite installed.
 */
async function getEntryService(): Promise<LexiconEntryService | undefined> {
  if (entryService) return entryService;
  try {
    await papi.networkObjectStatus.waitForNetworkObject(
      { id: ENTRY_SERVICE_ID },
      AVAILABILITY_TIMEOUT_MS,
    );
    entryService = await papi.networkObjects.get<LexiconEntryService>(ENTRY_SERVICE_ID);
  } catch (e) {
    logger.debug('Interlinearizer: the lexicon entry service is unavailable', e);
  }
  return entryService;
}

/** Discards the cached service so the next look-up starts over. */
export function resetEntryServiceForTesting(): void {
  entryService = undefined;
}

/**
 * Maps a lexicon sense to what the Interlinearizer displays. The gloss carries over as it stands;
 * FieldWorks Lite holds a definition as rich text and labels senses not at all, so neither has a
 * plain form to carry over yet.
 */
function toResolvedSense(sense: LexiconSense): ResolvedSense {
  return { gloss: sense.gloss };
}

/** Names every sense of `entry` for linking, alongside the form the entry is listed under. */
function toCandidates(entry: LexiconEntry, lexiconCode: string): SenseCandidate[] {
  return entry.senses.map((sense) => ({
    ...toResolvedSense(sense),
    lexemeForm: entry.lexemeForm,
    ref: { authority: FW_LITE_AUTHORITY, projectId: lexiconCode, senseId: sense.id },
  }));
}

/**
 * One connection to one FieldWorks Lite lexicon, or to none.
 *
 * With no lexicon connected the resolver still declares the authority, so a ref FW Lite minted
 * reads as a miss rather than as foreign, and it offers no capability, so nothing invites the user
 * to search or add to a lexicon that is not there.
 */
function createResolver(lexiconCode?: string): LexiconResolver {
  const connected = !!lexiconCode;
  return {
    authorities: [FW_LITE_AUTHORITY],
    capabilities: {
      search: connected,
      create: connected,
      // MiniLcm records neither: an entry carries one lexeme form and one morph type rather than a
      // set of allomorphs, and a sense carries a part of speech without the inflection class and
      // stem features an analysis would need.
      allomorphs: false,
      msas: false,
    },

    resolveSense: async (ref) => {
      // A ref naming another lexicon misses, whether or not that lexicon exists: the connected one
      // is the only lexicon this resolver answers for, so a relink leaves old refs to render as the
      // free-form gloss stored beside them.
      if (!lexiconCode || ref.projectId !== lexiconCode) return undefined;
      const sense = await (await getEntryService())?.getSense(lexiconCode, ref.senseId);
      return sense ? toResolvedSense(sense) : undefined;
    },

    searchByForm: async (form, options) => {
      if (!lexiconCode) return [];
      const entries =
        (await (await getEntryService())?.getEntries(lexiconCode, { surfaceForm: form })) ?? [];
      // The backend query narrows by form alone, so a writing system narrows the results here.
      const writingSystem = options?.writingSystem;
      const candidates = entries
        .filter((entry) => !writingSystem || entry.lexemeForm[writingSystem] !== undefined)
        .flatMap((entry) => toCandidates(entry, lexiconCode));
      return options?.limit === undefined ? candidates : candidates.slice(0, options.limit);
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
      const senseId = entry?.senses[0]?.id;
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
