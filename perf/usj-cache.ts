import fs from 'fs';
import path from 'path';
import { USJ_CACHE_DIR, usjDirFor } from './paths';

/** What a capture recorded about the project its USJ came from. */
export interface UsjCaptureMeta {
  projectId: string;
  projectName: string;
  /** The project's `platform.languageTag`, which tokenizing must use to match the app. */
  languageTag: string;
  /** Book codes captured, in canonical order. */
  books: string[];
  capturedAt: string;
  /** Paranext-core commit the USJ was produced by. */
  coreCommit: string;
}

const META_FILE = 'meta.json';

/** Writes one captured book. */
export function writeCapturedBook(projectId: string, bookCode: string, usj: unknown): void {
  const dir = usjDirFor(projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${bookCode}.json`), JSON.stringify(usj));
}

/** Writes a capture's metadata, last, so a capture with metadata is a complete one. */
export function writeCaptureMeta(meta: UsjCaptureMeta): void {
  fs.writeFileSync(
    path.join(usjDirFor(meta.projectId), META_FILE),
    JSON.stringify(meta, undefined, 2),
  );
}

/**
 * Reads the one complete capture in the cache.
 *
 * @throws If there is no complete capture, or more than one.
 */
export function readCaptureMeta(): UsjCaptureMeta {
  const metas = fs.existsSync(USJ_CACHE_DIR)
    ? fs
        .readdirSync(USJ_CACHE_DIR)
        .map((dir) => path.join(USJ_CACHE_DIR, dir, META_FILE))
        .filter((file) => fs.existsSync(file))
    : [];
  if (metas.length !== 1)
    throw new Error(
      `Expected one complete USJ capture under ${USJ_CACHE_DIR}, found ${metas.length}. Run \`npm run perf:capture\`.`,
    );
  return JSON.parse(fs.readFileSync(metas[0], 'utf-8'));
}

/** Reads one captured book's USJ. */
export function readCapturedBook(projectId: string, bookCode: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(usjDirFor(projectId), `${bookCode}.json`), 'utf-8'));
}
