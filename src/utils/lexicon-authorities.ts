import type { LexiconAuthority } from 'interlinearizer';

/**
 * The id space of every lexicon FieldWorks Lite holds. One space, not one per backing store: FW
 * Lite syncs a lexicon between its FwData and CRDT copies while preserving entry ids, so splitting
 * the space would strand a lexicon's existing refs the moment it gained a second copy.
 */
export const FW_LITE_AUTHORITY: LexiconAuthority = 'fw-lite';
