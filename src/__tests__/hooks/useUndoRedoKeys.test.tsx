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
