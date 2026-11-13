import { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { ChevronDown, Plus, Star } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import useSubmitGuard from '../../hooks/useSubmitGuard';
import type { AnalysisLanguagesChange } from '../../types/analysis-languages-change';
import type { TextCountsByTag } from '../../utils/text-counts';
import { ChangeLanguageConfirm } from '../modals/ChangeLanguageConfirm';
import { LanguageCodePicker } from '../modals/LanguageCodePicker';
import { hasText } from '../modals/language-text-counts';
import { RemoveLanguageConfirm } from '../modals/RemoveLanguageConfirm';

const STRING_KEYS = [
  '%interlinearizer_languageChips_menu%',
  '%interlinearizer_languageChips_menu_primary%',
  '%interlinearizer_languageChips_change%',
  '%interlinearizer_languageChips_makePrimary%',
  '%interlinearizer_languageChips_remove%',
  '%interlinearizer_languageChips_add%',
] as const satisfies `%${string}%`[];

/** Props for {@link AnalysisLanguageChips}. */
type AnalysisLanguageChipsProps = Readonly<{
  /** The analysis languages' codes, primary first. */
  languages: readonly string[];
  /** Id of the element labelling the row. */
  labelledBy: string;
  /**
   * Counts the glosses and free translations of every code that has any. The counts decide whether
   * an action asks before hiding or merging text. Actions wait for the first count, and the text is
   * counted again after each change. Absent, no action asks.
   */
  countText?: () => Promise<TextCountsByTag>;
  /** Applies a change. Absent to show the codes without letting them change. */
  onChange?: (change: AnalysisLanguagesChange) => Promise<void>;
  /** Whether the actions are unavailable for a reason outside the row. */
  disabled?: boolean;
}>;

/** The counts while none have arrived. */
const NO_COUNTS: TextCountsByTag = {};

/** A code change waiting for the user to confirm merging into a code that already has text. */
type PendingChange = { from: string; to: string };

/** What the code picker is open for, and where focus goes when it closes. */
type PickerState = { changing?: string; returnFocusTo?: HTMLElement };

/**
 * The analysis languages as a row of chips, primary first. Each chip's menu changes its code, makes
 * it primary, or removes it; a trailing button adds a code. Every action applies at once.
 *
 * Before an action would hide or merge glosses and free translations, it asks:
 *
 * - Removing a code that has text asks whether to keep the text hidden or delete it.
 * - Changing to a code that already has text asks before merging the two.
 *
 * Removing the primary makes the next code primary. The last code can't be removed.
 */
export default function AnalysisLanguageChips({
  languages,
  labelledBy,
  countText,
  onChange,
  disabled = false,
}: AnalysisLanguageChipsProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const { isSubmitting, runGuarded } = useSubmitGuard();
  const [picker, setPicker] = useState<PickerState | undefined>(undefined);
  const [pendingChange, setPendingChange] = useState<PendingChange | undefined>(undefined);
  const [pendingRemove, setPendingRemove] = useState<string | undefined>(undefined);
  const chipButtons = useRef(new Map<string, HTMLButtonElement>());
  const [counted, setCounted] = useState<TextCountsByTag | undefined>(countText ? undefined : {});
  const textCounts = counted ?? NO_COUNTS;

  /** Counts the text again. A failed count asks nothing, because no action deletes text unasked. */
  const recount = useCallback(async () => {
    if (!countText) return;
    try {
      setCounted(await countText());
    } catch (e) {
      logger.warn('Interlinearizer: could not count the text in each analysis language', e);
      setCounted({});
    }
  }, [countText]);

  useEffect(() => {
    recount();
  }, [recount]);

  const apply = useCallback(
    (change: AnalysisLanguagesChange) =>
      runGuarded(async () => {
        await onChange?.(change);
        await recount();
      }),
    [onChange, recount, runGuarded],
  );

  const commitChange = useCallback(
    ({ from, to }: PendingChange) =>
      apply({
        // When the new code is already listed, the merged code keeps the earlier of the two places.
        analysisLanguages: [...new Set(languages.map((tag) => (tag === from ? to : tag)))],
        retag: { from, to },
      }),
    [apply, languages],
  );

  const commitRemove = useCallback(
    (tag: string, deleteText: boolean) =>
      apply({
        analysisLanguages: languages.filter((language) => language !== tag),
        ...(deleteText && { deleteTextOf: tag }),
      }),
    [apply, languages],
  );

  const handlePick = useCallback(
    (tag: string) => {
      const changing = picker?.changing;
      setPicker(undefined);
      if (changing === undefined) {
        apply({ analysisLanguages: [...languages, tag] });
        return;
      }
      const change = { from: changing, to: tag };
      if (hasText(textCounts[tag])) setPendingChange(change);
      else commitChange(change);
    },
    [apply, commitChange, languages, picker, textCounts],
  );

  const handleRemove = useCallback(
    (tag: string) => {
      if (hasText(textCounts[tag])) setPendingRemove(tag);
      else commitRemove(tag, false);
    },
    [commitRemove, textCounts],
  );

  if (!onChange)
    return (
      <ul aria-labelledby={labelledBy} className="tw:flex tw:flex-wrap tw:gap-1.5">
        {languages.map((tag, index) => (
          <li
            key={tag}
            className="tw:inline-flex tw:items-center tw:gap-1 tw:rounded-md tw:border tw:px-2 tw:h-7 tw:text-sm tw:font-mono"
            data-testid={`analysis-language-chip-${tag}`}
          >
            {index === 0 && <PrimaryStar />}
            {tag}
          </li>
        ))}
      </ul>
    );

  const isBusy = disabled || isSubmitting || counted === undefined;
  const pendingRemoveCounts = pendingRemove === undefined ? undefined : textCounts[pendingRemove];
  const pendingChangeCounts = pendingChange && textCounts[pendingChange.to];

  return (
    <>
      <ul aria-labelledby={labelledBy} className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
        {languages.map((tag, index) => (
          <li key={tag}>
            <DropdownMenu>
              {/* Disabled on the trigger, because a disabled button still receives the pointerdown
                  that opens the menu. */}
              <DropdownMenuTrigger asChild disabled={isBusy}>
                <Button
                  variant="outline"
                  size="sm"
                  className="tw:h-7 tw:gap-1 tw:px-2 tw:font-mono"
                  data-testid={`analysis-language-chip-${tag}`}
                  aria-label={formatReplacementString(
                    localizedStrings[
                      index === 0
                        ? '%interlinearizer_languageChips_menu_primary%'
                        : '%interlinearizer_languageChips_menu%'
                    ],
                    { tag },
                  )}
                  ref={(button) => {
                    if (button) chipButtons.current.set(tag, button);
                    else chipButtons.current.delete(tag);
                  }}
                >
                  {index === 0 && <PrimaryStar />}
                  {tag}
                  <ChevronDown className="tw:size-3.5 tw:opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() =>
                    setPicker({ changing: tag, returnFocusTo: chipButtons.current.get(tag) })
                  }
                >
                  {localizedStrings['%interlinearizer_languageChips_change%']}
                </DropdownMenuItem>
                {index > 0 && (
                  <DropdownMenuItem
                    onSelect={() =>
                      apply({
                        analysisLanguages: [tag, ...languages.filter((other) => other !== tag)],
                      })
                    }
                  >
                    {localizedStrings['%interlinearizer_languageChips_makePrimary%']}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={languages.length < 2}
                  onSelect={() => handleRemove(tag)}
                >
                  {localizedStrings['%interlinearizer_languageChips_remove%']}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
        <li>
          <Button
            variant="ghost"
            size="sm"
            className="tw:h-7 tw:gap-1 tw:px-2"
            disabled={isBusy}
            data-testid="analysis-language-add"
            onClick={(event) => setPicker({ returnFocusTo: event.currentTarget })}
          >
            <Plus className="tw:size-3.5" />
            {localizedStrings['%interlinearizer_languageChips_add%']}
          </Button>
        </li>
      </ul>

      {picker && (
        <LanguageCodePicker
          changing={picker.changing}
          languages={languages}
          textCounts={textCounts}
          returnFocusTo={picker.returnFocusTo}
          onSubmit={handlePick}
          onCancel={() => setPicker(undefined)}
        />
      )}

      {pendingChange && pendingChangeCounts && (
        <ChangeLanguageConfirm
          from={pendingChange.from}
          to={pendingChange.to}
          toCounts={pendingChangeCounts}
          onConfirm={() => {
            setPendingChange(undefined);
            commitChange(pendingChange);
          }}
          onCancel={() => setPendingChange(undefined)}
        />
      )}

      {pendingRemove !== undefined && pendingRemoveCounts && (
        <RemoveLanguageConfirm
          tag={pendingRemove}
          counts={pendingRemoveCounts}
          onKeep={() => {
            setPendingRemove(undefined);
            commitRemove(pendingRemove, false);
          }}
          onDelete={() => {
            setPendingRemove(undefined);
            commitRemove(pendingRemove, true);
          }}
          onCancel={() => setPendingRemove(undefined)}
        />
      )}
    </>
  );
}

/** Marks the primary analysis language. */
function PrimaryStar() {
  return <Star aria-hidden className="tw:size-3 tw:fill-current" />;
}
