import type { MorphemeAnalysis } from 'interlinearizer';
import type { LanguageStrings } from 'platform-bible-utils';

/** Localized string keys the breakdown view renders. */
export const BREAKDOWN_VIEW_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_morphemeNoGloss%',
  '%interlinearizer_analysisCatalog_noBreakdown%',
] as const satisfies `%${string}%`[];

/** Props for {@link MorphemeBreakdownView}. */
type MorphemeBreakdownViewProps = Readonly<{
  morphemes: readonly MorphemeAnalysis[];
  /** BCP 47 tag the morpheme glosses are read under. */
  analysisLanguage: string;
  /** `data-testid` marking each morpheme column, and the not-split notice suffixed `-none`. */
  morphemeTestId: string;
  /** `data-testid` marking each column's gloss cell. */
  glossTestId: string;
  /** Resolved localizations covering at least {@link BREAKDOWN_VIEW_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/**
 * A breakdown the reader cannot edit: each morpheme's form over its gloss, and a word carrying no
 * breakdown saying so rather than leaving a gap the reader has to interpret.
 */
export default function MorphemeBreakdownView({
  morphemes,
  analysisLanguage,
  morphemeTestId,
  glossTestId,
  localizedStrings,
}: MorphemeBreakdownViewProps) {
  if (morphemes.length === 0)
    return (
      <span
        className="tw:text-sm tw:italic tw:text-muted-foreground"
        data-testid={`${morphemeTestId}-none`}
      >
        {localizedStrings['%interlinearizer_analysisCatalog_noBreakdown%']}
      </span>
    );

  return (
    <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1">
      {morphemes.map((morpheme) => {
        const gloss = morpheme.gloss?.[analysisLanguage];
        return (
          <div
            className="tw:flex tw:w-20 tw:shrink-0 tw:flex-col"
            data-testid={morphemeTestId}
            key={morpheme.id}
          >
            <span className="tw:truncate tw:text-sm">{morpheme.form}</span>
            {/* A blank cell reads as a rendering gap in a view offering no field to fill. */}
            <span
              className={`tw:text-sm tw:text-muted-foreground${gloss ? '' : ' tw:italic'}`}
              data-testid={glossTestId}
            >
              {gloss || localizedStrings['%interlinearizer_analysisCatalog_morphemeNoGloss%']}
            </span>
          </div>
        );
      })}
    </div>
  );
}
