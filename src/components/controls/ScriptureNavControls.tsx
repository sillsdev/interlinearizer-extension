import { useLocalizedStrings, useRecentScriptureRefs } from '@papi/frontend/react';
import {
  BOOK_CHAPTER_CONTROL_STRING_KEYS,
  BookChapterControl,
  BookChapterControlProps,
  ScrollGroupSelector,
  ScrollGroupSelectorProps,
} from 'platform-bible-react';

/** Fixed set of scroll-group IDs offered in the selector; `undefined` means "unlinked". */
const AVAILABLE_SCROLL_GROUPS = [undefined, 0, 1, 2, 3, 4];

/**
 * Localized string keys for {@link BookChapterControl}, hoisted to module scope so the array
 * reference passed to `useLocalizedStrings` is stable across renders (a fresh array each render
 * would make the hook re-fetch every render). Mirrors the `STRING_KEYS` pattern in the views.
 */
const STRING_KEYS = [...BOOK_CHAPTER_CONTROL_STRING_KEYS];

/**
 * Props for {@link ScriptureNavControls}. Combines the scripture-reference fields from
 * `BookChapterControlProps` with the scroll-group fields from `ScrollGroupSelectorProps`.
 */
type ScriptureNavControlsProps = Pick<BookChapterControlProps, 'scrRef' | 'handleSubmit'> &
  Pick<ScrollGroupSelectorProps, 'scrollGroupId' | 'onChangeScrollGroupId'>;

/**
 * Renders the scripture-navigation bar: a {@link BookChapterControl} for jumping to a reference and
 * a {@link ScrollGroupSelector} for linking the view to a scroll group.
 *
 * @param props - Component props.
 * @param props.scrRef - The currently displayed scripture reference.
 * @param props.handleSubmit - Called when the user submits a new reference.
 * @param props.scrollGroupId - The currently active scroll-group ID (`undefined` = unlinked).
 * @param props.onChangeScrollGroupId - Called when the user picks a different scroll group.
 * @returns A flex row containing the book/chapter control and scroll-group selector.
 */
export default function ScriptureNavControls({
  scrRef,
  handleSubmit,
  scrollGroupId,
  onChangeScrollGroupId,
}: ScriptureNavControlsProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const { recentScriptureRefs: recentRefs, addRecentScriptureRef: onAddRecentRef } =
    useRecentScriptureRefs();

  return (
    <div className="tw:flex tw:flex-row tw:items-center tw:gap-2">
      <BookChapterControl
        handleSubmit={handleSubmit}
        localizedStrings={localizedStrings}
        onAddRecentSearch={onAddRecentRef}
        recentSearches={recentRefs}
        scrRef={scrRef}
      />
      <ScrollGroupSelector
        availableScrollGroupIds={AVAILABLE_SCROLL_GROUPS}
        onChangeScrollGroupId={onChangeScrollGroupId}
        scrollGroupId={scrollGroupId}
      />
    </div>
  );
}
