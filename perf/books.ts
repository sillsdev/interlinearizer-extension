import type { Book } from 'interlinearizer';
import { tokenizeBook } from '../src/parsers/papi/bookTokenizer';
import { extractBookFromUsj, type UsjDocument } from '../src/parsers/papi/usjBookExtractor';
import { readCapturedBook, type UsjCaptureMeta } from './usj-cache';

function isUsjDocument(value: unknown): value is UsjDocument {
  return !!value && typeof value === 'object' && 'content' in value && Array.isArray(value.content);
}

/** Reads one captured book's USJ, typed as the extractor expects it. */
export function readUsj(meta: UsjCaptureMeta, bookCode: string): UsjDocument {
  const usj = readCapturedBook(meta.projectId, bookCode);
  if (!isUsjDocument(usj)) throw new Error(`Captured ${bookCode} is not USJ`);
  return usj;
}

/** Tokenizes captured books exactly as the WebView does. */
export function loadBooks(meta: UsjCaptureMeta, bookCodes: readonly string[]): Book[] {
  return bookCodes.map((code) =>
    tokenizeBook(extractBookFromUsj(readUsj(meta, code), meta.languageTag || 'und')),
  );
}
