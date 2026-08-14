/**
 * The shape revision this build produces, carried by every project and draft record as its
 * `modelVersion`.
 *
 * Bump it whenever a change to the persisted shape would leave an older record unreadable as-is —
 * that is what gives a reader a fact to branch on. Because the stamp asserts that the record
 * matches this revision, a read-modify-write must bring an older record up to this shape before
 * stamping it.
 */
export const CURRENT_MODEL_VERSION = 1;

/**
 * Refuses a stored record stamped with a shape revision higher than {@link CURRENT_MODEL_VERSION}: a
 * newer build wrote it, in a shape this build cannot represent. Reading it would present a partial
 * record as a whole one, and since every write stamps the current revision, writing it back would
 * relabel it as this shape — a lie the build that understands the record would then have to unpick.
 * Refusing at the storage boundary leaves it intact on disk for that build instead.
 *
 * A record with no usable stamp claims nothing about a shape this build cannot read, so it is left
 * to the validation each read already applies.
 *
 * @param record - The record as parsed from storage, before any validation.
 * @param description - Names the record in the error, e.g. `project abc`.
 * @throws {Error} If the stamp is a number higher than this build's revision.
 */
export function assertSupportedModelVersion(record: unknown, description: string): void {
  if (!record || typeof record !== 'object' || !('modelVersion' in record)) return;
  const { modelVersion } = record;
  if (typeof modelVersion === 'number' && modelVersion > CURRENT_MODEL_VERSION) {
    throw new Error(
      `Interlinearizer: ${description} has model version ${modelVersion}, which is newer than this build supports (${CURRENT_MODEL_VERSION})`,
    );
  }
}
