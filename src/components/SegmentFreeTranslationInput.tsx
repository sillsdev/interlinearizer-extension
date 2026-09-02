import { useLocalizedStrings } from '@papi/frontend/react';
import { useEffect, useState } from 'react';
import {
  useAnalysisReadOnly,
  useReportGlossEditing,
  useSegmentFreeTranslation,
  useSegmentFreeTranslationDispatch,
} from './AnalysisStore';
import { resolvedOrEmpty } from '../utils/localized-strings';

/**
 * Localized string keys this component needs. Hoisted to module scope so the reference passed to
 * `useLocalizedStrings` is stable across renders (a fresh array literal each render makes the PAPI
 * hook re-fetch and re-set state every render).
 */
const STRING_KEYS = [
  '%interlinearizer_freeTranslationInput_placeholder%',
  '%interlinearizer_freeTranslationInput_label%',
] as const satisfies `%${string}%`[];

/**
 * Free-translation input for a segment. Reads and writes the segment-level free translation from
 * the analysis store. Kept in its own component so the analysis-store hooks are always called
 * unconditionally.
 *
 * @param props.segmentId - `Segment.id` of the segment to read/write.
 * @param props.surfaceText - Current baseline text of the segment, stored on the `SegmentAnalysis`
 *   record so it can detect drift if the baseline changes later.
 * @param props.onFocus - Called when the input receives focus, so the parent can make the segment
 *   active.
 */
export default function SegmentFreeTranslationInput({
  segmentId,
  surfaceText,
  onFocus,
}: Readonly<{ segmentId: string; surfaceText: string; onFocus?: () => void }>) {
  const committed = useSegmentFreeTranslation(segmentId);
  const dispatchFreeTranslation = useSegmentFreeTranslationDispatch();
  const readOnly = useAnalysisReadOnly();
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const [draft, setDraft] = useState(committed);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  // Surface uncommitted typing to the unsaved indicator before the translation commits on blur.
  useReportGlossEditing(!readOnly && draft !== committed);

  // A read-only analysis shows the free translation as plain text - or nothing when it has none -
  // rather than as an input.
  if (readOnly) {
    if (committed === '') return undefined;
    return (
      <div
        className="tw:mt-2 tw:w-full tw:px-1.5 tw:py-0.5 tw:text-sm tw:text-foreground"
        data-testid="readonly-free-translation"
      >
        {committed}
      </div>
    );
  }

  return (
    <input
      aria-label={localizedStrings['%interlinearizer_freeTranslationInput_label%']}
      className="tw:mt-2 tw:w-full tw:rounded tw:border tw:border-border tw:bg-background tw:px-1.5 tw:py-0.5 tw:text-sm tw:text-foreground tw:outline-none tw:focus:border-ring tw:focus:ring-1 tw:focus:ring-ring"
      data-testid="segment-free-translation-input"
      placeholder={resolvedOrEmpty(
        localizedStrings['%interlinearizer_freeTranslationInput_placeholder%'],
      )}
      type="text"
      value={draft}
      onBlur={() => {
        if (draft !== committed) dispatchFreeTranslation(segmentId, surfaceText, draft);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={onFocus}
    />
  );
}
