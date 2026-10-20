import { Canon } from '@sillsdev/scripture';

/**
 * Reads the books that a `platformScripture.booksPresent` flag string marks present — one `'1'` per
 * present book, indexed by canonical book number — in canonical order. Flags past the end of the
 * canon mark nothing.
 */
export function presentBookIds(booksPresent: string): string[] {
  const bookCount = Math.min(booksPresent.length, Canon.allBookIds.length);
  const ids: string[] = [];
  for (let index = 0; index < bookCount; index += 1) {
    if (booksPresent[index] === '1') ids.push(Canon.bookNumberToId(index + 1));
  }
  return ids;
}
