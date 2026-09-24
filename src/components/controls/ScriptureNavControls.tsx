import { useLocalizedStrings, useRecentScriptureRefs } from '@papi/frontend/react';
import {
  BOOK_CHAPTER_CONTROL_STRING_KEYS,
  BookChapterControl,
  BookChapterControlProps,
  ScrollGroupSelector,
  ScrollGroupSelectorProps,
} from 'platform-bible-react';
import { useMemo } from 'react';

/** Fixed set of scroll-group IDs offered in the selector; `undefined` means "unlinked". */
const AVAILABLE_SCROLL_GROUPS = [undefined, 0, 1, 2, 3, 4];

/**
 * Localized string keys for {@link BookChapterControl}, hoisted to module scope so the array
 * reference passed to `useLocalizedStrings` is stable across renders (a fresh array each render
 * would make the hook re-fetch every render).
 */
const STRING_KEYS = [...BOOK_CHAPTER_CONTROL_STRING_KEYS];

/**
 * Props for {@link ScriptureNavControls}. Combines the scripture-reference fields from
 * `BookChapterControlProps` with the scroll-group fields from `ScrollGroupSelectorProps`.
 */
type ScriptureNavControlsProps = Pick<BookChapterControlProps, 'scrRef' | 'handleSubmit'> &
  Pick<ScrollGroupSelectorProps, 'scrollGroupId' | 'onChangeScrollGroupId'> & {
    /** Books the picker offers; the whole canon when `undefined`. */
    activeBookIds?: string[];
  };

/**
 * Renders the scripture-navigation bar: a {@link BookChapterControl} for jumping to a reference and
 * a {@link ScrollGroupSelector} for linking the view to a scroll group.
 */
export default function ScriptureNavControls({
  scrRef,
  handleSubmit,
  scrollGroupId,
  onChangeScrollGroupId,
  activeBookIds,
}: ScriptureNavControlsProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const { recentScriptureRefs: recentRefs, addRecentScriptureRef: onAddRecentRef } =
    useRecentScriptureRefs();
  const getActiveBookIds = useMemo(
    () => (activeBookIds ? () => activeBookIds : undefined),
    [activeBookIds],
  );

  return (
    <div className="tw:flex tw:flex-row tw:items-center tw:gap-2">
      <BookChapterControl
        getActiveBookIds={getActiveBookIds}
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
