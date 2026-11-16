/** What a step made in the analysis catalog tells the reader it was. */
type CatalogStepSummary = {
  form: string;
  /** The analysis whose catalog row the step acted on. */
  analysisId: string;
  /** The analysis holding that row once the step is made, absent when the step leaves none. */
  survivingAnalysisId?: string;
};

/** What an undo step made at no one place tells the reader it was, once undone or redone. */
export type StepSummary = Readonly<
  | (CatalogStepSummary & { kind: 'catalogEdit' | 'catalogMerge' | 'catalogDeleteUnused' })
  | (CatalogStepSummary & {
      kind: 'catalogDelete';
      /** How many uses the deleted analysis had, never zero. */
      count: number;
    })
  | {
      kind: 'catalogDeleteChecked';
      /** How many analyses were deleted. */
      count: number;
      /** How many uses they had between them. */
      usageCount: number;
    }
  | {
      kind: 'catalogClearGlossChecked';
      /** How many analyses had their gloss cleared. */
      count: number;
    }
  | { kind: 'discardBook'; book: string }
  | { kind: 'discardAll' }
  | { kind: 'changeAnalysisLanguages' }
  | {
      kind: 'retagGlosses';
      /** The tag the glosses and free translations moved from. */
      from: string;
      /** The tag they moved to. */
      to: string;
      /** How many word glosses moved. */
      words: number;
      /** How many morpheme glosses moved. */
      morphemes: number;
      /** How many free translations moved. */
      freeTranslations: number;
    }
  | {
      kind: 'deleteLanguageText';
      /** The tag removed from the analysis languages, whose text was deleted. */
      tag: string;
      /** How many glosses were deleted. */
      glosses: number;
      /** How many free translations were deleted. */
      freeTranslations: number;
    }
>;

/** An undo step, as recorded. */
export type EditStep = Readonly<{
  /** The token ref or segment id the step was made at, when it was made at one place. */
  location?: string;
  summary?: StepSummary;
}>;
