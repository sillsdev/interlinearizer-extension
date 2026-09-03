import { isPlatformError } from 'platform-bible-utils';

/**
 * Message marker on the error the platform throws when a project's PT9 interlinear data exceeds
 * what one response can carry: the fallback for errors that carry only a message.
 */
const PT9_TOO_LARGE_MARKER = 'PT9 interlinear data is too large';

/**
 * Whether an import failure is the platform's too-large refusal, recognized by the machine-readable
 * `RESOURCE_EXHAUSTED` platform error code, or by the documented message marker on errors that
 * carry only a message.
 */
export function isPt9TooLargeError(error: unknown): boolean {
  if (isPlatformError(error))
    // The narrowing proves less than the type does: a value can satisfy it without carrying the
    // declared message, and we want to answer rather than throw.
    return (
      error.code === 'RESOURCE_EXHAUSTED' ||
      (typeof error.message === 'string' && error.message.includes(PT9_TOO_LARGE_MARKER))
    );
  return error instanceof Error && error.message.includes(PT9_TOO_LARGE_MARKER);
}
