import { useLocalizedStrings } from '@papi/frontend/react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'platform-bible-react';
import { languageNameForTag } from '../../utils/language-tags';

const STRING_KEYS = ['%interlinearizer_analysisLanguage_label%'] as const satisfies `%${string}%`[];

/** Props for {@link AnalysisLanguageSelect}. */
type AnalysisLanguageSelectProps = Readonly<{
  /** BCP 47 tags to choose among, in the order offered. */
  languages: readonly string[];
  value: string;
  onValueChange: (tag: string) => void;
  /** Interface languages to name each tag in, most preferred first. */
  locales?: readonly string[];
}>;

/**
 * Toolbar picker for the analysis language glosses and free translations are shown and edited in.
 * Renders nothing when there is no choice to make.
 */
export default function AnalysisLanguageSelect({
  languages,
  value,
  onValueChange,
  locales,
}: AnalysisLanguageSelectProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  if (languages.length < 2) return undefined;

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={localizedStrings['%interlinearizer_analysisLanguage_label%']}
        className="tw:h-7 tw:w-auto"
        data-testid="analysis-language-select"
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {languages.map((tag) => (
          <SelectItem data-testid={`analysis-language-${tag}`} key={tag} value={tag}>
            {optionLabel(tag, locales)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Names `tag` with the tag beside it, since distinct tags can share a name. */
function optionLabel(tag: string, locales: readonly string[] | undefined): string {
  const name = languageNameForTag(tag, locales);
  return name.toLowerCase() === tag.toLowerCase() ? tag : `${name} (${tag})`;
}
