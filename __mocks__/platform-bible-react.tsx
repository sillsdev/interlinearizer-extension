/**
 * @file Jest mock for platform-bible-react. The real package ships ESM which Jest cannot parse
 * without extra transform configuration. This stub provides the subset used by extension
 * components: `cn`, `Button`, `BookChapterControl`, and `BOOK_CHAPTER_CONTROL_STRING_KEYS`.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

function flattenCn(arg: unknown): string[] {
  if (typeof arg === 'string') return arg.length > 0 ? [arg] : [];
  if (Array.isArray(arg)) return arg.flatMap(flattenCn);
  if (arg !== null && typeof arg === 'object')
    return Object.entries(arg as Record<string, unknown>)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
  return [];
}

export const cn = (...args: unknown[]): string => args.flatMap(flattenCn).join(' ');

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
  className?: string;
  localizedStrings?: Record<string, string>;
  recentSearches?: ScriptureRef[];
  onAddRecentSearch?: (scrRef: ScriptureRef) => void;
  id?: string;
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
