import type { Book } from 'interlinearizer';
import { isWordToken } from '../types/type-guards';
import { normalizeSurfaceForm } from './analysis-identity';

/** Every word form a tokenized book holds, normalized as analyses match them. */
export function formsOfBook(book: Book): Set<string> {
  const forms = new Set<string>();
  book.segments.forEach((segment) =>
    segment.tokens.forEach((token) => {
      if (isWordToken(token)) forms.add(normalizeSurfaceForm(token.surfaceText));
    }),
  );
  return forms;
}

/** The word forms a text holds, filed book by book so one book's forms can be replaced alone. */
export class FormIndex {
  private readonly formsByBook = new Map<string, ReadonlySet<string>>();

  /** How many filed books hold each form. */
  private readonly bookCounts = new Map<string, number>();

  /** Files `forms` as the forms `bookId` holds, in place of any filed for it before. */
  setBook(bookId: string, forms: ReadonlySet<string>): void {
    this.formsByBook.get(bookId)?.forEach((form) => {
      /* v8 ignore next -- defensive: a filed form always has a count */
      const count = (this.bookCounts.get(form) ?? 1) - 1;
      if (count === 0) this.bookCounts.delete(form);
      else this.bookCounts.set(form, count);
    });
    this.formsByBook.set(bookId, forms);
    forms.forEach((form) => this.bookCounts.set(form, (this.bookCounts.get(form) ?? 0) + 1));
  }

  /**
   * Whether a filed book holds `form`.
   *
   * @param form - Normalized as {@link formsOfBook} normalizes forms.
   */
  has(form: string): boolean {
    return this.bookCounts.has(form);
  }
}
