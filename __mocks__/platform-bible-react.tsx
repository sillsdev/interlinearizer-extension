/**
 * @file Jest mock for platform-bible-react. The real package ships ESM which Jest cannot parse
 * without extra transform configuration. This stub provides the subset used by extension
 * components: `cn`, `Button`, `BookChapterControl`, and `BOOK_CHAPTER_CONTROL_STRING_KEYS`.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const cn = (...args: unknown[]): string =>
  args
    .flat()
    .filter((v) => typeof v === 'string' && v.length > 0)
    .join(' ');

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: string;
  size?: string;
  children?: ReactNode;
  asChild?: boolean;
}

export function Button({ children, variant: _v, size: _s, asChild: _a, ...rest }: ButtonProps) {
  return <button type="button" {...rest}>{children}</button>;
}

interface ScriptureRef {
  book: string;
  chapterNum: number;
  verseNum: number;
}

export const BOOK_CHAPTER_CONTROL_STRING_KEYS: string[] = [];

export function BookChapterControl({
  scrRef,
  handleSubmit,
}: {
  scrRef: ScriptureRef;
  handleSubmit: (ref: ScriptureRef) => void;
  localizedStrings?: Record<string, string>;
  recentSearches?: ScriptureRef[];
  onAddRecentSearch?: (ref: ScriptureRef) => void;
}) {
  return (
    <div data-testid="book-chapter-control">
      {scrRef.book} {scrRef.chapterNum}:{scrRef.verseNum}
      <button type="button" onClick={() => handleSubmit(scrRef)}>
        Submit reference
      </button>
    </div>
  );
}
