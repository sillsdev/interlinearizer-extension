/**
 * @file The lexicon port: everything the Interlinearizer asks of a lexicon, stated in the
 *   Interlinearizer's own terms rather than in any one lexicon's model. A lexicon substitutes for
 *   another by implementing {@link LexiconResolver} and nothing more.
 *
 *   A resolver is one connection to one lexicon, and reaching that lexicon is the resolver's own
 *   business. Ordinarily one lexicon is connected, and glossing works with none connected at all.
 */

declare module 'interlinearizer/lexicon' {
  import type { EntryRef, LexiconAuthority, MultiString, SenseRef } from 'interlinearizer';

  /**
   * The one lexicon a Paratext project is linked to. Both halves are needed to name it: an
   * authority alone does not say which of its lexicons, and a lexicon id alone does not say whose
   * id space it belongs to.
   */
  export interface LexiconLink {
    authority: LexiconAuthority;

    /**
     * Names the lexicon within `authority`, in the same form a `LexiconRef` carries as its
     * `projectId`.
     */
    lexiconId: string;
  }

  /**
   * What a lexicon holds and permits, split finely enough to gate one affordance at a time. An
   * affordance is a piece of UI the user can act on, such as a lexicon search field or an "add to
   * lexicon" button.
   *
   * Lexicons differ in more than whether one is connected. A lexicon without FieldWorks Lite behind
   * it holds entries and senses but records no allomorphs and no morphosyntactic analyses, and a
   * lexicon connected for reading holds everything and still cannot be added to.
   *
   * A capability the lexicon lacks leaves its affordance unrendered rather than rendered and
   * disabled, so a lexicon that holds none of this looks like no lexicon at all rather than like a
   * broken version of one.
   */
  export interface LexiconCapabilities {
    /** The lexicon can be searched by surface form. */
    search: boolean;

    /** Entries can be added to the lexicon. */
    create: boolean;

    /**
     * The lexicon records allomorphs: the surface variants of a lexical form. Gates showing which
     * variant a morpheme was analyzed as.
     */
    allomorphs: boolean;

    /**
     * The lexicon records morphosyntactic analyses: the part of speech, inflection class, and stem
     * features of one (entry, sense, allomorph) usage. Gates showing a morpheme's grammatical
     * detail.
     */
    msas: boolean;
  }

  /** One thing a lexicon can do, named so a single affordance can be gated on it. */
  export type LexiconCapability = keyof LexiconCapabilities;

  /**
   * A sense as the Interlinearizer displays it: enough to render a gloss and to tell one sense of
   * an entry from another, and by design less than a lexicon knows about a sense.
   */
  export interface ResolvedSense {
    /** The lexicon's gloss for this sense, keyed by BCP 47 writing-system tag. */
    gloss: MultiString;

    /** Fuller wording of the sense, where the lexicon carries one beyond the gloss. */
    definition?: MultiString;

    /** The form the sense's entry is listed under, keyed by BCP 47 writing-system tag. */
    lexemeForm?: MultiString;

    /**
     * Tells this sense from the other senses of its entry, in the lexicon's own numbering. Absent
     * from a lexicon that does not number senses.
     */
    senseLabel?: string;
  }

  /** A sense a search turned up, carrying what an analysis stores to link to it. */
  export interface SenseCandidate extends ResolvedSense {
    /** Names the sense within the authority that minted it. */
    ref: SenseRef;
  }

  /** Narrows a search by surface form. */
  export interface SearchByFormOptions {
    /**
     * BCP 47 tag of the writing system the form is written in. When absent, every writing system
     * the lexicon holds forms in is searched.
     */
    writingSystem?: string;

    /** Caps how many candidates come back. When absent, the lexicon sets the count. */
    limit?: number;
  }

  /**
   * A new entry as the Interlinearizer describes one: a form and what it means. This is not an
   * entry editor, and the lexicon fills in whatever else an entry of its own needs.
   */
  export interface EntryDraft {
    /** Surface form the entry is created under. */
    form: string;

    /** BCP 47 tag of the writing system `form` is written in. */
    writingSystem: string;

    /** Gloss for the entry's sense, keyed by BCP 47 analysis-language tag. */
    gloss?: MultiString;
  }

  /** What a lexicon hands back for an entry it created, so an analysis can link to it. */
  export interface CreatedEntry {
    entryRef: EntryRef;

    /** The sense created with the entry, the one a gloss links to. */
    senseRef: SenseRef;
  }

  /**
   * One connection to one lexicon the Interlinearizer can read, search, and write one entry at a
   * time.
   *
   * The Interlinearizer works with no lexicon at all, so every implementation is substitutable, the
   * empty one included. No part of the UI asks which lexicon is connected, only what the connected
   * lexicon can do.
   */
  export interface LexiconResolver {
    /**
     * The id spaces this lexicon mints ids in and answers for, several where one connection fronts
     * more than one store of lexical data.
     *
     * A ref naming an authority that no connected resolver declares is foreign: it is never
     * resolved, never handed to a resolver, and never dropped. A project keeps the refs of whatever
     * lexicon glossed it, so foreign refs are ordinary rather than a fault.
     */
    authorities: readonly LexiconAuthority[];

    /** What this lexicon holds and permits. */
    capabilities: LexiconCapabilities;

    /**
     * Resolves a sense ref one of this lexicon's authorities minted.
     *
     * Whether a lexicon divides into projects is the lexicon's own business, so the ref's project
     * id is validated here and nowhere else: a ref that omits one where projects exist misses, and
     * the project in view is never taken as the one meant. A ref naming a project or a sense the
     * lexicon does not have misses too.
     *
     * @returns The sense, or `undefined` when the lexicon has no such sense.
     */
    resolveSense: (ref: SenseRef) => Promise<ResolvedSense | undefined>;

    /**
     * Finds the senses a surface form could be glossed by. How closely a candidate has to match the
     * form, and in what order candidates come back, is the lexicon's to decide.
     *
     * @returns The candidates, empty when nothing matches.
     * @throws When this lexicon cannot be searched, which its capabilities declare in advance.
     */
    searchByForm: (form: string, options?: SearchByFormOptions) => Promise<SenseCandidate[]>;

    /**
     * Adds an entry to the lexicon and names it for linking.
     *
     * Creating an entry mints ids, so a lexicon that implements this defines and exports the
     * {@link LexiconAuthority} constant naming its own id space, and stamps it on the refs it
     * returns. A lexicon that mints ids without naming its id space leaves its refs unresolvable by
     * anything, itself included.
     *
     * @throws When this lexicon cannot be written to, which its capabilities declare in advance.
     */
    createEntry: (draft: EntryDraft) => Promise<CreatedEntry>;
  }

  /**
   * One lexicon software a project can be linked to, and the way to reach the lexicons it holds.
   *
   * Two lifetimes are kept apart. A provider is _available_ for as long as the software behind it
   * can be reached, which is a fact about the session. It is _connected_ to one lexicon per linked
   * project, which is a fact about a project, so several connections can be live at once.
   */
  export interface LexiconProvider {
    /** The id space the lexicons behind this provider mint ids in and answer for. */
    authority: LexiconAuthority;

    /**
     * Whether the software behind this provider can be reached in this session. Reaching it may
     * mean waiting for it to start, so this answers late rather than wrongly.
     *
     * @returns `false` for software that is absent or does not answer in time, which is an ordinary
     *   configuration rather than a fault: the Interlinearizer glosses with no lexicon at all.
     */
    isAvailable: () => Promise<boolean>;

    /**
     * Connects to the lexicon a project is linked to.
     *
     * @param lexiconId - Names the lexicon within {@link LexiconProvider.authority}, in the form a
     *   {@link LexiconLink} holds it. Omitted for a project with no link, which yields a resolver
     *   that declares the authority and holds nothing - so a ref this software minted reads as a
     *   miss rather than as foreign while no lexicon is linked.
     */
    connect: (lexiconId?: string) => LexiconResolver;
  }
}
