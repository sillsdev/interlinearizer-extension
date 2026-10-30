import type { MorphemeAnalysis, SenseRef } from 'interlinearizer';
import { BookAlert, BookOpen } from 'lucide-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import LocalizedTooltip from './LocalizedTooltip';
import { useLinkedGloss, type LinkedGloss } from './LexiconSenses';
import { multiStringText } from '../utils/multi-string';

/** Localized string keys a {@link SenseLinkMark} renders. */
export const SENSE_LINK_MARK_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_senseLinked%',
  '%interlinearizer_analysisCatalog_senseGloss%',
  '%interlinearizer_analysisCatalog_senseDiffers%',
] as const satisfies `%${string}%`[];

/** Localized string keys {@link CatalogSenseLinks} renders beyond those its marks render. */
export const SENSE_LINKS_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_senseLinks%',
] as const satisfies `%${string}%`[];

/** Stands in for a morpheme with no form, as linguists write a zero morpheme. */
const ZERO_MORPHEME = '∅';

/**
 * Marks a gloss whose analysis links to a lexicon sense, telling apart a gloss that comes from the
 * sense and a typed gloss that differs from the sense's. A link that cannot be resolved is marked
 * as linked and nothing more.
 */
export function SenseLinkMark({
  link,
  localizedStrings,
}: Readonly<{
  link: LinkedGloss;
  /** Resolved localizations covering at least {@link SENSE_LINK_MARK_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>) {
  const label = markLabel(link, localizedStrings);
  const Icon = link.differs ? BookAlert : BookOpen;
  return (
    <LocalizedTooltip label={label}>
      <span
        className="tw:flex tw:shrink-0 tw:items-center tw:text-muted-foreground"
        data-differs={String(link.differs)}
        data-from-lexicon={String(link.fromLexicon)}
        data-testid="catalog-sense-link"
      >
        <Icon aria-hidden="true" className="tw:size-3" />
        <span className="tw:sr-only">{` ${label}`}</span>
      </span>
    </LocalizedTooltip>
  );
}

/** What a {@link SenseLinkMark} says about `link`. */
function markLabel(link: LinkedGloss, localizedStrings: LanguageStrings): string {
  if (link.differs)
    return formatReplacementString(
      localizedStrings['%interlinearizer_analysisCatalog_senseDiffers%'],
      { gloss: link.senseGloss },
    );
  if (link.fromLexicon) return localizedStrings['%interlinearizer_analysisCatalog_senseGloss%'];
  return localizedStrings['%interlinearizer_analysisCatalog_senseLinked%'];
}

/**
 * One analysis or morpheme's link: its form, the mark, and the linked sense's gloss once the sense
 * resolves.
 */
function SenseLinkLine({
  form,
  gloss,
  senseRef,
  analysisLanguage,
  localizedStrings,
}: Readonly<{
  form: string;
  /** The typed gloss in `analysisLanguage`, `''` when there is none. */
  gloss: string;
  senseRef: SenseRef;
  /** BCP 47 tag the glosses are compared in. */
  analysisLanguage: string;
  /** Resolved localizations covering at least {@link SENSE_LINK_MARK_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>) {
  const link = useLinkedGloss(gloss, senseRef, analysisLanguage);
  return (
    <li
      className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-1.5"
      data-testid="catalog-sense-line"
    >
      <span className="tw:font-medium">{form || ZERO_MORPHEME}</span>
      <SenseLinkMark link={link} localizedStrings={localizedStrings} />
      {link.senseGloss && (
        <span
          className="tw:min-w-0 tw:truncate tw:text-muted-foreground"
          data-testid="catalog-sense-gloss"
        >
          {link.senseGloss}
        </span>
      )}
    </li>
  );
}

/**
 * The lexicon senses an analysis and its morphemes link to, each beside the form that links to it.
 * Renders nothing when nothing is linked. Each sense is asked for only while the list is shown.
 */
export default function CatalogSenseLinks({
  surfaceText,
  gloss,
  glossSenseRef,
  morphemes,
  showMorphology,
  analysisLanguage,
  localizedStrings,
}: Readonly<{
  surfaceText: string;
  /** The analysis's typed gloss in `analysisLanguage`, `''` when it has none. */
  gloss: string;
  /** The sense the whole analysis links to. */
  glossSenseRef?: SenseRef;
  morphemes: readonly MorphemeAnalysis[];
  /** When false, the morphemes' links are not listed, as the view option hides the breakdown. */
  showMorphology: boolean;
  /** BCP 47 tag the glosses are compared in. */
  analysisLanguage: string;
  /**
   * Resolved localizations covering at least {@link SENSE_LINKS_STRING_KEYS} and
   * {@link SENSE_LINK_MARK_STRING_KEYS}.
   */
  localizedStrings: LanguageStrings;
}>) {
  const linkedMorphemes = showMorphology
    ? morphemes.flatMap((m) => (m.senseRef ? [{ morpheme: m, senseRef: m.senseRef }] : []))
    : [];
  if (!glossSenseRef && linkedMorphemes.length === 0) return undefined;

  return (
    <div className="tw:flex tw:flex-col tw:gap-0.5 tw:text-xs" data-testid="catalog-sense-links">
      <span className="tw:text-muted-foreground">
        {localizedStrings['%interlinearizer_analysisCatalog_senseLinks%']}
      </span>
      <ul className="tw:flex tw:flex-col tw:gap-0.5">
        {glossSenseRef && (
          <SenseLinkLine
            analysisLanguage={analysisLanguage}
            form={surfaceText}
            gloss={gloss}
            localizedStrings={localizedStrings}
            senseRef={glossSenseRef}
          />
        )}
        {linkedMorphemes.map(({ morpheme, senseRef }) => (
          <SenseLinkLine
            analysisLanguage={analysisLanguage}
            form={morpheme.form}
            gloss={multiStringText(morpheme.gloss, analysisLanguage)}
            key={morpheme.id}
            localizedStrings={localizedStrings}
            senseRef={senseRef}
          />
        ))}
      </ul>
    </div>
  );
}
