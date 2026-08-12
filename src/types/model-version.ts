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
