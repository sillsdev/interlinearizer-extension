/**
 * @file Jest mock for platform-bible-utils. Reimplements the minimal subset the extension uses so
 * tests never load the real package (which pulls in ESM deps).
 */

/** Sync unsubscriber: returns true on success. */
type Unsubscriber = () => boolean;

/** Async unsubscriber: resolves to true on success. */
type UnsubscriberAsync = () => Promise<boolean>;

/** Object that can be disposed synchronously or asynchronously. */
type Dispose = { dispose: Unsubscriber | UnsubscriberAsync };

/**
 * Minimal stand-in for the platform's unsubscriber list: collects unsubscribers and runs them all
 * on teardown.
 */
class UnsubscriberAsyncList {
  /** Set of callables to run on teardown. */
  readonly unsubscribers: Set<Unsubscriber | UnsubscriberAsync>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_name = 'Anonymous') {
    this.unsubscribers = new Set<Unsubscriber | UnsubscriberAsync>();
  }

  /**
   * Registers one or more unsubscribers. Accepts either a sync/async function returning boolean or
   * an object with a dispose() method; in the latter case the bound dispose is stored.
   */
  add(...unsubscribers: (Unsubscriber | UnsubscriberAsync | Dispose)[]): void {
    unsubscribers.forEach((unsubscriber) => {
      if (typeof unsubscriber === 'function') {
        this.unsubscribers.add(unsubscriber);
      } else if (
        typeof unsubscriber === 'object' &&
        unsubscriber !== null &&
        'dispose' in unsubscriber &&
        typeof unsubscriber.dispose === 'function'
      ) {
        this.unsubscribers.add(unsubscriber.dispose.bind(unsubscriber));
      }
    });
  }

  /**
   * Runs all registered unsubscribers (awaiting any promises) and clears the set, reporting whether
   * every one of them returned `true`.
   */
  async runAllUnsubscribers(): Promise<boolean> {
    const unsubs = [...this.unsubscribers].map((fn) => fn());
    const results = await Promise.all(unsubs);
    this.unsubscribers.clear();
    return results.every(Boolean);
  }
}

/**
 * Minimal PlatformError shape matching the real platform-bible-utils type. Uses `platformErrorVersion`
 * as the discriminant — the same field the real `isPlatformError` checks.
 */
interface PlatformError {
  cause?: unknown;
  code?: string;
  message: string;
  platformErrorVersion: number;
  stack?: string;
}

/**
 * Returns `true` when `error` is a {@link PlatformError}, identified by the presence of the
 * `platformErrorVersion` discriminant field.
 */
const isPlatformError = (error: unknown): error is PlatformError =>
  typeof error === 'object' &&
  error !== null &&
  'platformErrorVersion' in error &&
  typeof (error as Record<string, unknown>).platformErrorVersion === 'number' &&
  !Number.isNaN((error as Record<string, unknown>).platformErrorVersion);

/**
 * Splits `str` around its `{name}` placeholders, substituting each with the matching replacer value
 * or, failing that, the bare name. A string with no placeholder — an unresolved localize key, say —
 * yields itself as the only entry. The real function also unescapes `\{`/`\}`, unused here.
 */
const formatReplacementStringToArray = <T,>(
  str: string,
  replacers: { [key: string]: T },
): (string | T)[] => {
  const parts: (string | T)[] = [];
  let lastIndex = 0;
  for (const match of str.matchAll(/\{([^{}]*)\}/g)) {
    const name = match[1];
    if (match.index > lastIndex) parts.push(str.slice(lastIndex, match.index));
    parts.push(name in replacers ? replacers[name] : name);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < str.length) parts.push(str.slice(lastIndex));
  return parts;
};

/** Same substitution as {@link formatReplacementStringToArray}, joined back into one string. */
const formatReplacementString = (str: string, replacers: { [key: string]: unknown }): string =>
  formatReplacementStringToArray(str, replacers)
    .map((part) => String(part))
    .join('');

/**
 * Language-sensitive string comparison, wrapping `Intl.Collator` as the real class does. Throws on
 * a tag `Intl` cannot parse, as the real one does.
 */
class Collator {
  private collator: Intl.Collator;

  constructor(locales?: string | string[], options?: Intl.CollatorOptions) {
    this.collator = new Intl.Collator(locales, options);
  }

  compare(string1: string, string2: string): number {
    return this.collator.compare(string1, string2);
  }

  resolvedOptions(): Intl.ResolvedCollatorOptions {
    return this.collator.resolvedOptions();
  }
}

/** The book, chapter, and verse of a scripture reference; the real type carries more. */
type SerializedVerseRef = { book: string; chapterNum: number; verseNum: number };

/**
 * Formats a scripture reference as the real function does for its default options, e.g. `GEN 1:1`.
 * The book-name and separator options are unused here.
 */
const formatScrRef = (scrRef: SerializedVerseRef): string =>
  `${scrRef.book} ${scrRef.chapterNum}:${scrRef.verseNum}`;

export {
  Collator,
  UnsubscriberAsyncList,
  formatReplacementString,
  formatReplacementStringToArray,
  formatScrRef,
  isPlatformError,
};
