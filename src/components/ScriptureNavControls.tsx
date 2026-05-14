import { useLocalizedStrings, useRecentScriptureRefs } from '@papi/frontend/react';
import { useMemo } from 'react';
import {
  BOOK_CHAPTER_CONTROL_STRING_KEYS,
  BookChapterControl,
  BookChapterControlProps,
  ScrollGroupSelector,
  ScrollGroupSelectorProps,
} from 'platform-bible-react';

/**
 * Scroll group IDs offered to the user. `undefined` means "no scroll group" (the WebView scrolls
 * independently); numeric IDs 0–4 correspond to Platform.Bible's shared scroll groups.
 */
const AVAILABLE_SCROLL_GROUPS = [undefined, 0, 1, 2, 3, 4];

/**
 * Props for {@link ScriptureNavControls}. Combines the scripture-reference fields from
 * `BookChapterControlProps` with the scroll-group fields from `ScrollGroupSelectorProps`.
 */
type ScriptureNavControlsProps = Pick<BookChapterControlProps, 'scrRef' | 'handleSubmit'> &
  Pick<ScrollGroupSelectorProps, 'scrollGroupId' | 'onChangeScrollGroupId'>;

/**
 * Toolbar row combining a {@link BookChapterControl} for scripture navigation with a
 * {@link ScrollGroupSelector} for Platform.Bible scroll-group linking.
 *
 * @param props - Component props
 * @param props.scrRef - Current scripture reference displayed in the book/chapter picker.
 * @param props.handleSubmit - Called when the user submits a new scripture reference.
 * @param props.scrollGroupId - Currently active scroll group ID (or `undefined` for none).
 * @param props.onChangeScrollGroupId - Called when the user selects a different scroll group.
 * @returns A flex row containing the book/chapter control and the scroll group selector.
 */
export default function ScriptureNavControls({
  scrRef,
  handleSubmit,
  scrollGroupId,
  onChangeScrollGroupId,
}: ScriptureNavControlsProps) {
  const [localizedStrings] = useLocalizedStrings(
    useMemo(() => [...BOOK_CHAPTER_CONTROL_STRING_KEYS], []),
  );
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
