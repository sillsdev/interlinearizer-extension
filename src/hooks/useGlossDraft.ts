import { type Dispatch, type SetStateAction, useState } from 'react';

/**
 * The text a gloss input holds before it commits, starting from the gloss it displays.
 *
 * A change to the stored gloss replaces the draft, as any edit made elsewhere does. A change in the
 * lexicon gloss alone replaces the draft only while the reader has not typed into it. A sense can
 * resolve mid-edit, and its gloss must not erase what the reader typed.
 *
 * The input edits only the stored gloss, never the sense ref. So emptying a gloss shown from the
 * lexicon has nothing to write.
 *
 * @param stored - The gloss stored with the analysis, `''` when there is none.
 * @param displayed - The gloss the input shows: `stored`, or the lexicon's gloss where nothing is
 *   stored.
 * @returns The draft, its setter, and whether committing the draft writes anything. When it writes
 *   nothing, the caller puts the draft back to `displayed`.
 */
export default function useGlossDraft(
  stored: string,
  displayed: string,
): [string, Dispatch<SetStateAction<string>>, boolean] {
  const [draft, setDraft] = useState(displayed);
  const [seen, setSeen] = useState({ stored, displayed });

  // Adjusted during render rather than in an effect, so no render reaches the screen with the draft
  // behind the gloss. Such a render would report a pending edit. An unmount during it would write the
  // stale draft as a stored gloss.
  if (seen.stored !== stored || seen.displayed !== displayed) {
    setSeen({ stored, displayed });
    if (seen.stored !== stored || draft === seen.displayed) setDraft(displayed);
  }

  const writes = draft !== displayed && (draft.trim() !== '' || stored.trim() !== '');
  return [draft, setDraft, writes];
}
