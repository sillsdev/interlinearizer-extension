import type { PageFailureCause } from '../types/segment-pages';

/** The start of the message of an error that names its cause. The cause follows in parentheses. */
const MARK = 'Interlinearizer page read failed';

const MARKED = new RegExp(`${MARK} \\((text|analysis)\\)`);

/**
 * The message of `error`: its `message` when it has one, as an `Error` or a PAPI error does, or
 * else the error as a string.
 */
function messageOf(error: unknown): string {
  // A PAPI error reaches a WebView from the window's realm, where `instanceof Object` fails.
  const message =
    !!error && typeof error === 'object' && 'message' in error ? error.message : undefined;
  return typeof message === 'string' ? message : String(error);
}

/**
 * Runs `read`, naming `cause` in the message of any error it throws. The named cause survives the
 * trip across PAPI, which keeps only an error's message.
 *
 * @throws An `Error` whose message names `cause` and then gives the message of the error thrown.
 */
export async function readNamingCause<T>(
  cause: Exclude<PageFailureCause, 'app'>,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new Error(`${MARK} (${cause}): ${messageOf(error)}`, { cause: error });
  }
}

/** What made a page read fail: the cause that `error` names, or `app` when it names none. */
export function pageFailureCauseOf(error: unknown): PageFailureCause {
  const cause = MARKED.exec(messageOf(error))?.[1];
  return cause === 'text' || cause === 'analysis' ? cause : 'app';
}
