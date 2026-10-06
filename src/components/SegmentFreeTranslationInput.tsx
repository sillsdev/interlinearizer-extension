import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { useEffect, useRef, useState } from 'react';
import {
  useAnalysisReadOnly,
  useReportGlossEditing,
  useSegmentFreeTranslation,
  useSegmentFreeTranslationDispatch,
  useSegmentHasApprovedTranslation,
  useStaleFreeTranslationDispatch,
} from './AnalysisStore';
import { resolvedOrEmpty } from '../utils/localized-strings';
import {
  adoptedStaleTranslation,
  type StaleFreeTranslation,
} from '../utils/stale-free-translations';

/**
 * Localized string keys this component needs. Hoisted to module scope so the reference passed to
 * `useLocalizedStrings` is stable across renders (a fresh array literal each render makes the PAPI
 * hook re-fetch and re-set state every render).
 */
const STRING_KEYS = [
  '%interlinearizer_freeTranslationInput_placeholder%',
  '%interlinearizer_freeTranslationInput_label%',
  '%interlinearizer_freeTranslationInput_stale%',
  '%interlinearizer_freeTranslationInput_staleKeep%',
  '%interlinearizer_freeTranslationInput_staleDiscard%',
  '%interlinearizer_freeTranslationInput_staleNoText%',
  '%interlinearizer_freeTranslationInput_staleKeepBlocked%',
] as const satisfies `%${string}%`[];

const NO_STALE: readonly StaleFreeTranslation[] = [];

/**
 * Segment whose input was focused when it unmounted, so the replacement can take the focus back.
 *
 * Focusing this input makes its segment active, which hydrates the segment — and hydration swaps
 * the whole segment between two different components, unmounting this input and dropping the focus
 * the click had just placed.
 *
 * Expires at the end of the frame that armed it, so only the swap's own remount reclaims the focus
 * and a later one leaves the caret wherever the user has since put it.
 */
let refocus: { segmentId: string; timer: ReturnType<typeof setTimeout> } | undefined;

function clearRefocus() {
  if (!refocus) return;
  clearTimeout(refocus.timer);
  refocus = undefined;
}

/**
 * Free-translation input for a segment. Reads and writes the segment-level free translation from
 * the analysis store. Kept in its own component so the analysis-store hooks are always called
 * unconditionally.
 *
 * Also offers the stale translations the segment shows for review, each to keep for the text as it
 * now reads or to discard. A lone stale translation standing in for no approved one fills the input
 * instead, so editing it is where the reviewer starts.
 *
 * @param props.segmentId - `Segment.id` of the segment to read/write.
 * @param props.surfaceText - Current baseline text of the segment, stored on the `SegmentAnalysis`
 *   record so it can detect drift if the baseline changes later.
 * @param props.onFocus - Called when the input receives focus, so the parent can make the segment
 *   active.
 * @param props.stale - The stale translations the segment shows, in document order.
 */
export default function SegmentFreeTranslationInput({
  segmentId,
  surfaceText,
  onFocus,
  stale = NO_STALE,
}: Readonly<{
  segmentId: string;
  surfaceText: string;
  onFocus?: () => void;
  stale?: readonly StaleFreeTranslation[];
}>) {
  const committed = useSegmentFreeTranslation(segmentId);
  const hasApproved = useSegmentHasApprovedTranslation(segmentId);
  const dispatchFreeTranslation = useSegmentFreeTranslationDispatch();
  const staleDispatch = useStaleFreeTranslationDispatch();
  const readOnly = useAnalysisReadOnly();
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);

  /** The stale translation the input starts from, when one stands in for an approved translation. */
  const adopted = adoptedStaleTranslation(stale, hasApproved);
  const initial = adopted?.text ?? committed;
  const [draft, setDraft] = useState(initial);
  const inputRef = useRef<HTMLInputElement | undefined>(undefined);
  // Tracked from the focus/blur handlers rather than read off `document.activeElement` at unmount,
  // which has already reset to the body by the time React runs the cleanup.
  const isFocusedRef = useRef(false);

  // Reclaim the focus a hydration swap dropped, so the click that hydrated the segment still lands
  // the caret in the replacement input rather than costing the user a second click.
  useEffect(() => {
    if (refocus?.segmentId !== segmentId) return;
    clearRefocus();
    inputRef.current?.focus({ preventScroll: true });
  }, [segmentId]);

  // Records this input as the one to refocus when it unmounts while focused. Unmounting fires no
  // blur, so nothing else notices the focus was lost.
  useEffect(
    () => () => {
      if (!isFocusedRef.current) return;
      clearRefocus();
      refocus = { segmentId, timer: setTimeout(clearRefocus, 0) };
    },
    [segmentId],
  );

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  /** Writes the draft translation only when it differs from what the input started from. */
  const commitDraft = () => {
    if (draft === initial) return;
    if (adopted) dispatchFreeTranslation(segmentId, surfaceText, draft, adopted.analysisId);
    else dispatchFreeTranslation(segmentId, surfaceText, draft);
  };

  // Surface uncommitted typing to the unsaved indicator before the translation commits on blur, and
  // flush the draft if the input unmounts mid-edit. A read-only segment has no input, so it never
  // reports.
  useReportGlossEditing(!readOnly && draft !== initial, commitDraft);

  // A listed stale translation's Keep keeps its own text, which would drop what is typed beside it.
  const keepBlocked = !hasApproved && !adopted && draft.trim() !== '';

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

  const input = (
    <input
      aria-label={localizedStrings['%interlinearizer_freeTranslationInput_label%']}
      data-draft-field
      className={`tw:mt-2 tw:w-full tw:rounded tw:border tw:border-border tw:bg-background tw:px-1.5 tw:py-0.5 tw:text-sm tw:outline-none tw:focus:border-ring tw:focus:ring-1 tw:focus:ring-ring ${
        adopted && draft === adopted.text ? 'tw:gloss-stale' : 'tw:text-foreground'
      }`}
      data-testid="segment-free-translation-input"
      placeholder={resolvedOrEmpty(
        localizedStrings['%interlinearizer_freeTranslationInput_placeholder%'],
      )}
      ref={(el) => {
        inputRef.current = el ?? undefined;
      }}
      type="text"
      value={draft}
      onBlur={() => {
        isFocusedRef.current = false;
        commitDraft();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        isFocusedRef.current = true;
        onFocus?.();
      }}
    />
  );
  if (stale.length === 0) return input;

  /** Keep and Discard for one stale translation; Keep only while the segment has no approval. */
  const reviewControls = (translation: StaleFreeTranslation) => (
    <>
      {!hasApproved && (
        <Button
          data-testid="stale-free-translation-keep"
          disabled={keepBlocked}
          onClick={() => {
            // An edit of the adopted translation commits in its place, but a blank one would clear it.
            if (adopted && draft !== initial && draft.trim() !== '') {
              dispatchFreeTranslation(segmentId, surfaceText, draft, adopted.analysisId);
              return;
            }
            // Set here, since keeping an adopted translation leaves `initial` unchanged.
            setDraft(translation.text);
            staleDispatch.keep(translation.analysisId, segmentId, surfaceText);
          }}
          // Holds the input's focus, since a blur committing mid-click removes this button.
          onMouseDown={(event) => event.preventDefault()}
          size="sm"
          type="button"
          variant="outline"
        >
          {localizedStrings['%interlinearizer_freeTranslationInput_staleKeep%']}
        </Button>
      )}
      <Button
        data-testid="stale-free-translation-discard"
        onClick={() => {
          // An edit of the adopted translation is discarded with it; one typed beside listed ones
          // is kept.
          if (!adopted) commitDraft();
          staleDispatch.discard(translation.analysisId);
        }}
        // Holds the input's focus, since a blur committing mid-click shifts this button from under
        // the pointer.
        onMouseDown={(event) => event.preventDefault()}
        size="sm"
        type="button"
        variant="ghost"
      >
        {localizedStrings['%interlinearizer_freeTranslationInput_staleDiscard%']}
      </Button>
    </>
  );

  return (
    <>
      {input}
      <div
        className="tw:mt-1 tw:flex tw:flex-col tw:gap-1 tw:text-sm"
        data-testid="stale-free-translations"
      >
        <span className="tw:text-xs tw:gloss-stale">
          {localizedStrings['%interlinearizer_freeTranslationInput_stale%']}
        </span>
        {keepBlocked && (
          <span className="tw:text-xs tw:text-muted-foreground" data-testid="stale-keep-blocked">
            {localizedStrings['%interlinearizer_freeTranslationInput_staleKeepBlocked%']}
          </span>
        )}
        {adopted ? (
          <div className="tw:flex tw:gap-1">{reviewControls(adopted)}</div>
        ) : (
          stale.map((translation) => (
            <div
              className="tw:flex tw:flex-wrap tw:items-center tw:gap-1"
              data-analysis-id={translation.analysisId}
              data-testid="stale-free-translation"
              key={translation.analysisId}
            >
              <span className="tw:gloss-stale">
                {translation.text ||
                  localizedStrings['%interlinearizer_freeTranslationInput_staleNoText%']}
              </span>
              {reviewControls(translation)}
            </div>
          ))
        )}
      </div>
    </>
  );
}
