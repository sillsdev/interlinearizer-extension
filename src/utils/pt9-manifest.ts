import papi from '@papi/frontend';

/**
 * How long a manifest read may go unanswered before {@link readPt9Manifest} gives up on it. A
 * project data provider that accepts the call and never responds would otherwise leave its caller
 * waiting for the life of the tab.
 */
export const PT9_MANIFEST_TIMEOUT_MS = 15_000;

/**
 * Reads the source project's Paratext 9 interlinear manifest: every interlinear file it serves, by
 * path, with the hash an import compares against to tell whether the source has changed. An empty
 * manifest means the source serves no interlinear data at all.
 *
 * @throws If the source has no `platformScripture.Pt9Interlinear` projectInterface, the read
 *   rejects, or it goes unanswered for {@link PT9_MANIFEST_TIMEOUT_MS}. A caller that waits on this
 *   behind blocking UI can therefore always finish. The timeout bounds the wait, not the read: PAPI
 *   offers no cancellation, so an unanswered read stays outstanding and its late result is
 *   dropped.
 */
export function readPt9Manifest(sourceProjectId: string): Promise<Record<string, string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Paratext 9 interlinear manifest read for ${sourceProjectId} went unanswered after ${PT9_MANIFEST_TIMEOUT_MS}ms`,
          ),
        ),
      PT9_MANIFEST_TIMEOUT_MS,
    );
  });
  const read = (async () => {
    const pdp = await papi.projectDataProviders.get(
      'platformScripture.Pt9Interlinear',
      sourceProjectId,
    );
    return pdp.getPt9InterlinearManifest();
  })();
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
}
