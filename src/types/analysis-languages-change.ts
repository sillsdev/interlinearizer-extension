import { isGlossRetagCounts, type GlossRetagCounts } from '../utils/retag-glosses';
import { isLanguageTextCounts, type LanguageTextCounts } from '../utils/text-counts';

/** A change to a draft's analysis languages, with any text it moves or deletes. */
export type AnalysisLanguagesChange = Readonly<{
  /** The draft's new analysis languages, primary first; never empty. */
  analysisLanguages: string[];
  /** Glosses and free translations to move from one tag to another; never to the same tag. */
  retag?: Readonly<{ from: string; to: string }>;
  /** The tag whose glosses and free translations are deleted. Never given with `retag`. */
  deleteTextOf?: string;
}>;

/** What a change of analysis languages did to the draft's text. */
export type AnalysisLanguagesChangeOutcome = {
  /** What moved, when the change asked for a move. */
  glossRetag?: GlossRetagCounts;
  /** What was deleted, when the change asked for a deletion. */
  deletedText?: LanguageTextCounts;
};

/** The {@link AnalysisLanguagesChangeOutcome} in a command reply, leaving out malformed parts. */
export function analysisLanguagesChangeOutcomeOf(reply: unknown): AnalysisLanguagesChangeOutcome {
  if (!reply || typeof reply !== 'object') return {};
  const glossRetag = 'glossRetag' in reply ? reply.glossRetag : undefined;
  const deletedText = 'deletedText' in reply ? reply.deletedText : undefined;
  return {
    ...(isGlossRetagCounts(glossRetag) && { glossRetag }),
    ...(isLanguageTextCounts(deletedText) && { deletedText }),
  };
}
