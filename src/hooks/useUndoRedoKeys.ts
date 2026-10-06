import { isMacOs } from 'platform-bible-react';
import { useEffect } from 'react';
import useLatestRef from './useLatestRef';

/** What {@link useUndoRedoKeys} binds the shortcuts to. */
type UndoRedoKeysOptions = Readonly<{
  undo: () => void;
  redo: () => void;
}>;

/** Whether a shortcut pressed in `target` belongs to that text field's own undo. */
function belongsToTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
  return !target.closest('[data-draft-field="committed"]');
}

/** The letter a shortcut names, taking a non-Latin layout's key as the QWERTY letter it sits on. */
function shortcutLetter({ key, code }: KeyboardEvent): string {
  return (/^\P{ASCII}$/u.test(key) ? code.replace(/^Key/, '') : key).toLowerCase();
}

/**
 * Binds the platform's undo and redo shortcuts, anywhere in the WebView, to the draft's history. A
 * text field keeps them for its own typing unless it is marked `data-draft-field="committed"`, as
 * every field whose committed text is draft content must be while it holds nothing uncommitted. A
 * field its own undo has just returned to committed text still keeps redo, so the typing that undo
 * took can be restored.
 */
export default function useUndoRedoKeys(options: UndoRedoKeysOptions): void {
  const optionsRef = useLatestRef(options);

  useEffect(() => {
    const isMac = isMacOs();
    // Whether the focused field's latest edit was its own undo.
    let fieldOwnsRedo = false;
    const handleInput = (event: Event) => {
      fieldOwnsRedo = event instanceof InputEvent && event.inputType === 'historyUndo';
    };
    const handleFocusOut = () => {
      fieldOwnsRedo = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      // Windows reports AltGr as Ctrl+Alt, and AltGr+Z types a letter on some layouts.
      if (event.altKey || !(isMac ? event.metaKey : event.ctrlKey)) return;
      const key = shortcutLetter(event);
      let isRedo: boolean;
      if (key === 'z') isRedo = event.shiftKey;
      else if (key === 'y' && !isMac) isRedo = true;
      else return;
      if (belongsToTextField(event.target) || (isRedo && fieldOwnsRedo)) return;
      event.preventDefault();
      fieldOwnsRedo = false;
      const { undo, redo } = optionsRef.current;
      if (isRedo) redo();
      else undo();
    };
    window.addEventListener('input', handleInput);
    window.addEventListener('focusout', handleFocusOut);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('input', handleInput);
      window.removeEventListener('focusout', handleFocusOut);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [optionsRef]);
}
