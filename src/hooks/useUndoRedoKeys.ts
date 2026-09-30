import { isMacOs } from 'platform-bible-react';
import { useEffect } from 'react';
import useLatestRef from './useLatestRef';

/** What {@link useUndoRedoKeys} binds the shortcuts to. */
type UndoRedoKeysOptions = Readonly<{
  undo: () => void;
  redo: () => void;
  /** Whether a draft field holds text it has not committed yet. */
  hasPendingEdits: boolean;
}>;

/** Whether a shortcut pressed in `target` belongs to that text field's own undo. */
function belongsToTextField(target: EventTarget | null, hasPendingEdits: boolean): boolean {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
  return hasPendingEdits || !target.closest('[data-draft-field]');
}

/**
 * Binds the platform's undo and redo shortcuts, anywhere in the WebView, to the draft's history. A
 * text field keeps them for its own typing unless it holds nothing uncommitted and is marked
 * `data-draft-field`, as every field whose committed text is draft content must be.
 */
export default function useUndoRedoKeys(options: UndoRedoKeysOptions): void {
  const optionsRef = useLatestRef(options);

  useEffect(() => {
    const isMac = isMacOs();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(isMac ? event.metaKey : event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const { undo, redo, hasPendingEdits } = optionsRef.current;
      let action: (() => void) | undefined;
      if (key === 'z' && !event.shiftKey) action = undo;
      else if (key === 'z' || (key === 'y' && !isMac)) action = redo;
      if (!action || belongsToTextField(event.target, hasPendingEdits)) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [optionsRef]);
}
