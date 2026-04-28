/**
 * @file Jest mock for platform-bible-react. The real package ships ESM which Jest cannot parse
 * without extra transform configuration. This stub provides the subset used by extension
 * components: `BookChapterControl`, `BOOK_CHAPTER_CONTROL_STRING_KEYS`, `TabToolbar`, and
 * `ScrollGroupSelector`.
 */

import type { ReactElement, ReactNode } from 'react';

interface ScriptureRef {
  book: string;
  chapterNum: number;
  verseNum: number;
}

export const BOOK_CHAPTER_CONTROL_STRING_KEYS: string[] = [];

export function TabToolbar({
  startAreaChildren,
  endAreaChildren,
}: Readonly<{
  className?: string;
  startAreaChildren?: ReactNode;
  endAreaChildren?: ReactNode;
  onSelectProjectMenuItem?: () => void;
  onSelectViewInfoMenuItem?: () => void;
}>): ReactElement {
  return (
    <div data-testid="tab-toolbar">
      <div data-testid="tab-toolbar-start">{startAreaChildren}</div>
      <div data-testid="tab-toolbar-end">{endAreaChildren}</div>
    </div>
  );
}

export function ScrollGroupSelector({
  scrollGroupId,
  onChangeScrollGroupId,
}: Readonly<{
  availableScrollGroupIds?: (number | undefined)[];
  scrollGroupId?: number;
  onChangeScrollGroupId?: (id: number | undefined) => void;
}>): ReactElement {
  return (
    <select
      data-testid="scroll-group-selector"
      value={scrollGroupId ?? ''}
      onChange={(e) => onChangeScrollGroupId?.(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

export function BookChapterControl({
  scrRef,
  handleSubmit,
  onAddRecentSearch,
}: Readonly<{
  scrRef: ScriptureRef;
  handleSubmit: (ref: ScriptureRef) => void;
  className?: string;
  localizedStrings?: Record<string, string>;
  recentSearches?: ScriptureRef[];
  onAddRecentSearch?: (scrRef: ScriptureRef) => void;
  id?: string;
}>): ReactElement {
  return (
    <div data-testid="book-chapter-control">
      {scrRef.book} {scrRef.chapterNum}:{scrRef.verseNum}
      <button type="button" onClick={() => {handleSubmit(scrRef); onAddRecentSearch?.(scrRef);}}>
        Submit reference
      </button>
    </div>
  );
}
