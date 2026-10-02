/// <reference types="jest" />

import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import useUndoRedoKeys from '../../hooks/useUndoRedoKeys';
import { pretendMacOs } from '../test-helpers';

/** Binds the hook to fresh undo and redo spies. */
function renderKeys() {
  const undo = jest.fn();
  const redo = jest.fn();
  const view = renderHook(() => useUndoRedoKeys({ undo, redo }));
  return { undo, redo, ...view };
}

describe('useUndoRedoKeys', () => {
  it('undoes on Ctrl+Z', () => {
    const { undo } = renderKeys();

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });

    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('redoes on Ctrl+Y', () => {
    const { redo } = renderKeys();

    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });

    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('redoes rather than undoes on Ctrl+Shift+Z', () => {
    const { undo, redo } = renderKeys();

    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });

    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it('claims the shortcut from the browser', () => {
    renderKeys();

    const notCanceled = fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });

    expect(notCanceled).toBe(false);
  });

  it('leaves other shortcuts to the browser', () => {
    const { undo, redo } = renderKeys();

    const notCanceled = fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });

    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
    expect(notCanceled).toBe(true);
  });

  it('leaves Ctrl+Z to a text field that holds no draft content', () => {
    const { undo } = renderKeys();
    render(<input aria-label="search" />);

    const notCanceled = fireEvent.keyDown(screen.getByLabelText('search'), {
      key: 'z',
      ctrlKey: true,
    });

    expect(undo).not.toHaveBeenCalled();
    expect(notCanceled).toBe(true);
  });

  it('leaves Ctrl+Z to a draft field holding uncommitted text', () => {
    const { undo } = renderKeys();
    render(<input aria-label="gloss" data-draft-field="pending" />);

    fireEvent.keyDown(screen.getByLabelText('gloss'), { key: 'z', ctrlKey: true });

    expect(undo).not.toHaveBeenCalled();
  });

  it('undoes from a draft field with nothing uncommitted while another holds uncommitted text', () => {
    const { undo } = renderKeys();
    render(
      <>
        <input aria-label="pending gloss" data-draft-field="pending" />
        <input aria-label="gloss" data-draft-field="committed" />
      </>,
    );

    fireEvent.keyDown(screen.getByLabelText('gloss'), { key: 'z', ctrlKey: true });

    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('undoes from a draft field with nothing uncommitted', () => {
    const { undo } = renderKeys();
    render(<textarea aria-label="translation" data-draft-field="committed" />);

    fireEvent.keyDown(screen.getByLabelText('translation'), { key: 'z', ctrlKey: true });

    expect(undo).toHaveBeenCalledTimes(1);
  });

  describe("after a draft field's own undo returns it to its committed text", () => {
    /** Renders a committed draft field and undoes typing in it the way the browser does. */
    function undoNatively(): HTMLElement {
      render(<input aria-label="gloss" data-draft-field="committed" />);
      const field = screen.getByLabelText('gloss');
      fireEvent.input(field, { inputType: 'historyUndo' });
      return field;
    }

    it('leaves redo to the field', () => {
      const { redo } = renderKeys();
      const field = undoNatively();

      const notCanceled = fireEvent.keyDown(field, { key: 'Z', ctrlKey: true, shiftKey: true });

      expect(redo).not.toHaveBeenCalled();
      expect(notCanceled).toBe(true);
    });

    it('still undoes from the draft', () => {
      const { undo } = renderKeys();
      const field = undoNatively();

      fireEvent.keyDown(field, { key: 'z', ctrlKey: true });

      expect(undo).toHaveBeenCalledTimes(1);
    });

    it('redoes from the draft once the field is edited again', () => {
      const { redo } = renderKeys();
      const field = undoNatively();

      fireEvent.input(field, { inputType: 'deleteContentBackward' });
      fireEvent.keyDown(field, { key: 'y', ctrlKey: true });

      expect(redo).toHaveBeenCalledTimes(1);
    });

    it('redoes from the draft once the field loses focus', () => {
      const { redo } = renderKeys();
      const field = undoNatively();

      fireEvent.focusOut(field);
      fireEvent.keyDown(field, { key: 'y', ctrlKey: true });

      expect(redo).toHaveBeenCalledTimes(1);
    });

    it('redoes from the draft what a draft undo just undid', () => {
      const { redo } = renderKeys();
      const field = undoNatively();

      fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
      fireEvent.keyDown(field, { key: 'y', ctrlKey: true });

      expect(redo).toHaveBeenCalledTimes(1);
    });
  });

  it('stops listening once unmounted', () => {
    const { undo, unmount } = renderKeys();

    unmount();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });

    expect(undo).not.toHaveBeenCalled();
  });

  describe('on macOS', () => {
    beforeEach(() => pretendMacOs());

    it('undoes on ⌘Z', () => {
      const { undo } = renderKeys();

      fireEvent.keyDown(document.body, { key: 'z', metaKey: true });

      expect(undo).toHaveBeenCalledTimes(1);
    });

    it('redoes on ⌘⇧Z', () => {
      const { redo } = renderKeys();

      fireEvent.keyDown(document.body, { key: 'Z', metaKey: true, shiftKey: true });

      expect(redo).toHaveBeenCalledTimes(1);
    });

    it('leaves Ctrl+Z alone', () => {
      const { undo } = renderKeys();

      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });

      expect(undo).not.toHaveBeenCalled();
    });
  });
});
