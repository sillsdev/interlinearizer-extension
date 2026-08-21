/// <reference types="jest" />

import { fireEvent, render, screen } from '@testing-library/react';
import usePanelResizeKeys from '../../hooks/usePanelResizeKeys';

/** Narrowest and widest shares of the group a press may reach. */
const BOUNDS = { min: 0.15, max: 0.5 };

/** Renders a separator driven by the hook, standing in for the platform resize handle. */
function renderHandle(fraction: number, onFractionChange: (fraction: number) => void) {
  function Handle() {
    const onKeyDown = usePanelResizeKeys(fraction, onFractionChange, BOUNDS);
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
    return <div data-testid="handle" onKeyDown={onKeyDown} role="separator" tabIndex={0} />;
  }
  render(<Handle />);
  return screen.getByTestId('handle');
}

/**
 * Presses `key` on the handle, with `init` supplying any modifiers held.
 *
 * @returns Whether the press was claimed, leaving the platform handle to ignore it.
 */
function press(handle: HTMLElement, key: string, init: object = {}): boolean {
  return !fireEvent.keyDown(handle, { key, ...init });
}

describe('usePanelResizeKeys', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir');
  });

  describe('in a left-to-right interface', () => {
    it('leaves the arrows to the platform handle, which already reads them correctly', () => {
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.25, onFractionChange);

      const defaulted = press(handle, 'ArrowLeft');

      expect(onFractionChange).not.toHaveBeenCalled();
      expect(defaulted).toBe(false);
    });
  });

  describe('in a right-to-left interface', () => {
    beforeEach(() => {
      document.documentElement.dir = 'rtl';
    });

    it('narrows the panel on ArrowLeft, which points away from the edge it is anchored to', () => {
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.25, onFractionChange);

      press(handle, 'ArrowLeft');

      expect(onFractionChange).toHaveBeenCalledWith(0.2);
    });

    it('widens the panel on ArrowRight', () => {
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.25, onFractionChange);

      press(handle, 'ArrowRight');

      expect(onFractionChange).toHaveBeenCalledWith(0.3);
    });

    it('claims the mirrored arrow, so the platform handle leaves it alone', () => {
      const handle = renderHandle(0.25, () => {});

      expect(press(handle, 'ArrowRight')).toBe(true);
    });

    it('holds a widening arrow to the widest the panel may be', () => {
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.48, onFractionChange);

      press(handle, 'ArrowRight');

      expect(onFractionChange).toHaveBeenCalledWith(0.5);
    });

    it('reports nothing for an arrow held down at the end of the range', () => {
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.5, onFractionChange);

      press(handle, 'ArrowRight');

      expect(onFractionChange).not.toHaveBeenCalled();
    });
  });

  describe('jumping to an end of the range', () => {
    it('sends the panel to its narrowest on Home', () => {
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.25, onFractionChange);

      press(handle, 'Home');

      expect(onFractionChange).toHaveBeenCalledWith(BOUNDS.min);
    });

    it('sends the panel to its widest on End', () => {
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.25, onFractionChange);

      press(handle, 'End');

      expect(onFractionChange).toHaveBeenCalledWith(BOUNDS.max);
    });

    it('jumps the same way whichever side the interface anchors the panel to', () => {
      document.documentElement.dir = 'rtl';
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.25, onFractionChange);

      press(handle, 'Home');

      expect(onFractionChange).toHaveBeenCalledWith(BOUNDS.min);
    });

    it('reports nothing on End when the panel is already at its widest', () => {
      const onFractionChange = jest.fn();
      const handle = renderHandle(BOUNDS.max, onFractionChange);

      press(handle, 'End');

      expect(onFractionChange).not.toHaveBeenCalled();
    });
  });

  describe('keys it does not act on', () => {
    it('leaves the panel alone on a key that resizes nothing', () => {
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.25, onFractionChange);

      press(handle, 'a');

      expect(onFractionChange).not.toHaveBeenCalled();
    });

    it('leaves a modified jump key for the host to act on', () => {
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.25, onFractionChange);

      // Ctrl+Home is a document-level shortcut in some hosts, which swallowing it would break.
      const defaulted = press(handle, 'Home', { ctrlKey: true });

      expect(onFractionChange).not.toHaveBeenCalled();
      expect(defaulted).toBe(false);
    });

    it.each(['metaKey', 'altKey'])('leaves a %s-modified arrow alone', (modifier) => {
      document.documentElement.dir = 'rtl';
      const onFractionChange = jest.fn();
      const handle = renderHandle(0.25, onFractionChange);

      press(handle, 'ArrowRight', { [modifier]: true });

      expect(onFractionChange).not.toHaveBeenCalled();
    });
  });

  it('resizes from the share it is given rather than one it remembers', () => {
    // The caller holds the layout, so a share changed elsewhere — by a drag, or by a restored
    // layout — is what the next press has to step from.
    document.documentElement.dir = 'rtl';
    const onFractionChange = jest.fn();

    function Handle({ fraction }: Readonly<{ fraction: number }>) {
      const onKeyDown = usePanelResizeKeys(fraction, onFractionChange, BOUNDS);
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
      return <div data-testid="handle" onKeyDown={onKeyDown} role="separator" tabIndex={0} />;
    }
    const { rerender } = render(<Handle fraction={0.25} />);
    rerender(<Handle fraction={0.4} />);

    press(screen.getByTestId('handle'), 'ArrowRight');

    expect(onFractionChange).toHaveBeenCalledWith(0.45);
  });
});
