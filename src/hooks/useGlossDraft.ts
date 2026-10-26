import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';

/**
 * The text a gloss input holds before it commits, starting from the gloss it displays.
 *
 * A change to the stored gloss replaces the draft, as any edit made elsewhere does. A change in the
 * lexicon gloss alone replaces the draft only while the reader has not typed into it. A sense can
 * resolve mid-edit, and its gloss must not erase what the reader typed.
 *
 * @param stored - The gloss stored with the analysis, `''` when there is none.
 * @param displayed - The gloss the input shows: `stored`, or the lexicon's gloss where nothing is
 *   stored.
 * @returns The draft and its setter.
 */
export default function useGlossDraft(
  stored: string,
  displayed: string,
): [string, Dispatch<SetStateAction<string>>] {
  const [draft, setDraft] = useState(displayed);
  const previous = useRef({ stored, displayed });

  useEffect(() => {
    const before = previous.current;
    previous.current = { stored, displayed };
    if (before.stored !== stored) setDraft(displayed);
    else setDraft((current) => (current === before.displayed ? displayed : current));
  }, [stored, displayed]);

  return [draft, setDraft];
}
