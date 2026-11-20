/**
 * Runs `run`. A failure is logged to `logger` as a failure to `what` before the same error is
 * rethrown.
 *
 * @throws Whatever `run` throws.
 */
export async function logAndRethrow<T>(
  logger: Readonly<{ error: (message: string, error: unknown) => void }>,
  what: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    logger.error(`Interlinearizer: failed to ${what}`, e);
    throw e;
  }
}
