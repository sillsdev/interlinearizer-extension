/// <reference types="jest" />

import { fireEvent, render, screen } from '@testing-library/react';
import usePanelResizeKeys from '../../hooks/usePanelResizeKeys';

/** Narrowest and widest percentages of the group a press may reach. */
const BOUNDS = { min: 15, max: 50 };

/** Renders a separator driven by the hook, standing in for the platform resize handle. */
function renderHandle(percentage: number, onPercentageChange: (percentage: number) => void) {
  function Handle() {
    const onKeyDown = usePanelResizeKeys(percentage, onPercentageChange, BOUNDS);
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
      const onPercentageChange = jest.fn();
      const handle = renderHandle(25, onPercentageChange);

      const defaulted = press(handle, 'ArrowLeft');

      expect(onPercentageChange).not.toHaveBeenCalled();
      expect(defaulted).toBe(false);
    });
  });

  describe('in a right-to-left interface', () => {
    beforeEach(() => {
      document.documentElement.dir = 'rtl';
    });

    it('narrows the panel on ArrowLeft, which points away from the edge it is anchored to', () => {
      const onPercentageChange = jest.fn();
      const handle = renderHandle(25, onPercentageChange);

      press(handle, 'ArrowLeft');

      expect(onPercentageChange).toHaveBeenCalledWith(20);
    });

    it('widens the panel on ArrowRight', () => {
      const onPercentageChange = jest.fn();
      const handle = renderHandle(25, onPercentageChange);

      press(handle, 'ArrowRight');

      expect(onPercentageChange).toHaveBeenCalledWith(30);
    });

    it('claims the mirrored arrow, so the platform handle leaves it alone', () => {
      const handle = renderHandle(25, () => {});

      expect(press(handle, 'ArrowRight')).toBe(true);
    });

    it('holds a widening arrow to the widest the panel may be', () => {
      const onPercentageChange = jest.fn();
      const handle = renderHandle(48, onPercentageChange);

      press(handle, 'ArrowRight');

      expect(onPercentageChange).toHaveBeenCalledWith(50);
    });

    it('reports nothing for an arrow held down at the end of the range', () => {
      const onPercentageChange = jest.fn();
      const handle = renderHandle(50, onPercentageChange);

      press(handle, 'ArrowRight');

      expect(onPercentageChange).not.toHaveBeenCalled();
    });
  });

  describe('jumping to an end of the range', () => {
    it('sends the panel to its narrowest on Home', () => {
      const onPercentageChange = jest.fn();
      const handle = renderHandle(25, onPercentageChange);

      press(handle, 'Home');

      expect(onPercentageChange).toHaveBeenCalledWith(BOUNDS.min);
    });

    it('sends the panel to its widest on End', () => {
      const onPercentageChange = jest.fn();
      const handle = renderHandle(25, onPercentageChange);

      press(handle, 'End');

      expect(onPercentageChange).toHaveBeenCalledWith(BOUNDS.max);
    });

    it('jumps the same way whichever side the interface anchors the panel to', () => {
      document.documentElement.dir = 'rtl';
      const onPercentageChange = jest.fn();
      const handle = renderHandle(25, onPercentageChange);

      press(handle, 'Home');

      expect(onPercentageChange).toHaveBeenCalledWith(BOUNDS.min);
    });

    it('reports nothing on End when the panel is already at its widest', () => {
      const onPercentageChange = jest.fn();
      const handle = renderHandle(BOUNDS.max, onPercentageChange);

      press(handle, 'End');

      expect(onPercentageChange).not.toHaveBeenCalled();
    });
  });

  describe('keys it does not act on', () => {
    it('leaves the panel alone on a key that resizes nothing', () => {
      const onPercentageChange = jest.fn();
      const handle = renderHandle(25, onPercentageChange);

      press(handle, 'a');

      expect(onPercentageChange).not.toHaveBeenCalled();
    });

    it('leaves a modified jump key for the host to act on', () => {
      const onPercentageChange = jest.fn();
      const handle = renderHandle(25, onPercentageChange);

      // Ctrl+Home is a document-level shortcut in some hosts, which swallowing it would break.
      const defaulted = press(handle, 'Home', { ctrlKey: true });

      expect(onPercentageChange).not.toHaveBeenCalled();
      expect(defaulted).toBe(false);
    });

    it.each(['metaKey', 'altKey'])('leaves a %s-modified arrow alone', (modifier) => {
      document.documentElement.dir = 'rtl';
      const onPercentageChange = jest.fn();
      const handle = renderHandle(25, onPercentageChange);

      press(handle, 'ArrowRight', { [modifier]: true });

      expect(onPercentageChange).not.toHaveBeenCalled();
    });
  });

  it('resizes from the percentage it is given rather than one it remembers', () => {
    // The caller holds the layout, so a percentage changed elsewhere — by a drag, or by a restored
    // layout — is what the next press has to step from.
    document.documentElement.dir = 'rtl';
    const onPercentageChange = jest.fn();

    function Handle({ percentage }: Readonly<{ percentage: number }>) {
      const onKeyDown = usePanelResizeKeys(percentage, onPercentageChange, BOUNDS);
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
      return <div data-testid="handle" onKeyDown={onKeyDown} role="separator" tabIndex={0} />;
    }
    const { rerender } = render(<Handle percentage={25} />);
    rerender(<Handle percentage={40} />);

    press(screen.getByTestId('handle'), 'ArrowRight');

    expect(onPercentageChange).toHaveBeenCalledWith(45);
  });
});
