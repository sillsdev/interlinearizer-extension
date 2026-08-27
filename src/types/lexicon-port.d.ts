/**
 * @file The lexicon port: everything the interlinearizer asks of a lexicon, in its own terms rather
 *   than any one lexicon's model. A lexicon substitutes for another by implementing
 *   {@link LexiconResolver} and nothing more.
 */

declare module 'interlinearizer/lexicon' {
  import type { EntryRef, LexiconAuthority, MultiString, SenseRef } from 'interlinearizer';

  /**
   * What a lexicon holds and permits, split finely enough to gate one affordance at a time.
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

    /** The lexicon records allomorphs — the surface variants of a lexical form. */
    allomorphs: boolean;

    /**
     * The lexicon records morphosyntactic analyses: the part of speech, inflection class, and stem
     * features of one (entry x sense x allomorph) usage.
     */
    msas: boolean;
  }

  /** One thing a lexicon can do, named so an affordance can be gated on it alone. */
  export type LexiconCapability = keyof LexiconCapabilities;

  /**
   * A sense as the interlinearizer displays it: enough to render a gloss and to tell one sense of
   * an entry from another. Deliberately less than a lexicon knows about a sense.
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
     * BCP 47 tag of the writing system the form is written in. Absent searches every writing system
     * the lexicon holds forms in.
     */
    writingSystem?: string;

    /** Caps how many candidates come back. Absent leaves the count to the lexicon. */
    limit?: number;
  }

  /**
   * A new entry as the interlinearizer describes one: a form and what it means. This is not an
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
    /** The new entry. */
    entryRef: EntryRef;

    /** The sense created with the entry, the one a gloss links to. */
    senseRef: SenseRef;
  }

  /**
   * A lexicon the interlinearizer can read, search, and write one entry at a time.
   *
   * The interlinearizer works with no lexicon at all, so every implementation is substitutable
   * including the empty one, and no part of the UI asks which lexicon is present — it asks what the
   * lexicon can do.
   */
  export interface LexiconResolver {
    /**
     * The id spaces this lexicon answers for. A ref naming an authority that no registered resolver
     * declares is foreign: it is never resolved, never handed to a resolver, and never dropped.
     */
    authorities: readonly LexiconAuthority[];

    /** What this lexicon holds and permits. */
    capabilities: LexiconCapabilities;

    /**
     * Resolves a sense ref this lexicon's authority minted.
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
}
