/**
 * @file Jest mock for platform-bible-utils/experimental. The real entry point requires core's
 * staged scripture-utilities package, which the unit-test job does not install.
 */

/** Returns the book list each test sets, whatever `booksPresent` string it is passed. */
export const getBookIdsFromBooksPresent = jest.fn<string[], [string]>();
