import { useLocalizedStrings, useRecentScriptureRefs } from '@papi/frontend/react';
import { useMemo } from 'react';
import {
  BOOK_CHAPTER_CONTROL_STRING_KEYS,
  BookChapterControl,
  BookChapterControlProps,
  ScrollGroupSelector,
  ScrollGroupSelectorProps,
} from 'platform-bible-react';

const AVAILABLE_SCROLL_GROUPS = [undefined, 0, 1, 2, 3, 4];

type ScriptureNavControlsProps = Pick<BookChapterControlProps, 'scrRef' | 'handleSubmit'> &
  Pick<ScrollGroupSelectorProps, 'scrollGroupId' | 'onChangeScrollGroupId'>;

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
    <div className="tw-flex tw-flex-row tw-items-center tw-gap-2">
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
