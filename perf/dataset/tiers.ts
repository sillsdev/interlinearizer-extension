/** The shape of one dataset tier's analysis. Every share is a probability in `[0, 1]`. */
export interface TierSpec {
  name: string;
  /** Book codes analyzed, or every captured book. */
  books: string[] | 'all';
  /** Book the view is opened on when measuring loads and edits. */
  viewBook: string;
  /** Share of word tokens carrying a gloss, approved or stale. */
  coverage: number;
  /** Share of glossed tokens whose gloss is stale. */
  staleShare: number;
  /** Share of glossed tokens also carrying a suggested or rejected competitor. */
  competingShare: number;
  /** Share of glossed word tokens that start an approved phrase. */
  phraseShare: number;
  /** Share of phrases that run on into the next segment. */
  crossSegmentPhraseShare: number;
  /** Share of segments carrying a free translation. */
  freeTranslationShare: number;
  /** Share of token payloads carrying a morpheme breakdown. */
  morphemeShare: number;
  /** Saved projects per source, each holding the draft's analysis. */
  savedProjects: number;
}

const SHAPE = {
  staleShare: 0.03,
  competingShare: 0.1,
  phraseShare: 0.02,
  crossSegmentPhraseShare: 0.1,
  freeTranslationShare: 0.3,
  morphemeShare: 0.2,
  savedProjects: 5,
};

/** Sizes run for every metric, so cost can be read as a function of size. */
export const TIERS: TierSpec[] = [
  { name: 'small', books: ['PHP'], viewBook: 'PHP', coverage: 1, ...SHAPE },
  { name: 'medium', books: ['PSA'], viewBook: 'PSA', coverage: 1, ...SHAPE },
  // Larger than one websocket message can carry, so the app cannot load it.
  { name: 'large', books: 'all', viewBook: 'PSA', coverage: 0.5, ...SHAPE },
  // The whole Bible at the coverage whose draft, and the list of its saved projects, each fit one
  // message.
  {
    name: 'large-loadable',
    books: 'all',
    viewBook: 'PSA',
    coverage: 0.3,
    ...SHAPE,
    savedProjects: 1,
  },
];

/** Seed every dataset is generated from. */
export const DATASET_SEED = 407;
