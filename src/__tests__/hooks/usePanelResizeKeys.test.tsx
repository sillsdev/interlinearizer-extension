/// <reference types="jest" />

import { fireEvent, render, screen } from '@testing-library/react';
import usePanelResizeKeys from '../../hooks/usePanelResizeKeys';

/**
 * Renders a separator driven by the hook, standing in for the platform resize handle.
 *
 * The handle's own key listener is bound to the element rather than passed as a React prop, as the
 * platform's is, so that a press reaches the hook in the order it would in the app.
 *
 * @returns The rendered handle, and a spy called with the key of every press the handle was left to
 *   act on itself.
 */
function renderHandle(percentage: number, onPercentageChange: (percentage: number) => void) {
  const platformSteps = jest.fn();

  function Handle() {
    const ref = usePanelResizeKeys(percentage, onPercentageChange);
    return (
      <div
        data-testid="handle"
        ref={(element) => {
          ref(element);
          // Bound after the hook's, and in the bubble phase, as the platform's listener is: it
          // stands down only for a press the hook has already claimed.
          element?.addEventListener('keydown', (event) => {
            if (event.defaultPrevented) return;
            platformSteps(event.key);
          });
        }}
        role="separator"
        // Focusable as the real separator is, which is what puts key presses within its reach.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      />
    );
  }
  render(<Handle />);
  return { handle: screen.getByTestId('handle'), platformSteps };
}

/** Presses `key` on the handle, with `init` supplying any modifiers held. */
function press(handle: HTMLElement, key: string, init: object = {}): void {
  fireEvent.keyDown(handle, { key, ...init });
}

describe('usePanelResizeKeys', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir');
  });

  describe('in a left-to-right interface', () => {
    it('leaves the arrows to the platform handle, which already reads them correctly', () => {
      const onPercentageChange = jest.fn();
      const { handle, platformSteps } = renderHandle(25, onPercentageChange);

      press(handle, 'ArrowLeft');

      expect(onPercentageChange).not.toHaveBeenCalled();
      expect(platformSteps).toHaveBeenCalledWith('ArrowLeft');
    });
  });

  describe('in a right-to-left interface', () => {
    beforeEach(() => {
      document.documentElement.dir = 'rtl';
    });

    it('narrows the panel on ArrowLeft, which points away from the edge it is anchored to', () => {
      const onPercentageChange = jest.fn();
      const { handle } = renderHandle(25, onPercentageChange);

      press(handle, 'ArrowLeft');

      expect(onPercentageChange).toHaveBeenCalledWith(20);
    });

    it('widens the panel on ArrowRight', () => {
      const onPercentageChange = jest.fn();
      const { handle } = renderHandle(25, onPercentageChange);

      press(handle, 'ArrowRight');

      expect(onPercentageChange).toHaveBeenCalledWith(30);
    });

    it('claims the mirrored arrow, so the platform handle does not step it a second time', () => {
      const { handle, platformSteps } = renderHandle(25, () => {});

      press(handle, 'ArrowRight');

      expect(platformSteps).not.toHaveBeenCalled();
    });

    it('narrows the panel fully on Home, landing where ArrowLeft points', () => {
      const onPercentageChange = jest.fn();
      const { handle } = renderHandle(25, onPercentageChange);

      press(handle, 'Home');

      // The end of the range, not the panel's own floor: that floor is a pixel width only the group
      // can resolve, so the press it is handed is the unclamped one.
      expect(onPercentageChange).toHaveBeenCalledWith(0);
    });

    it('widens the panel fully on End, landing where ArrowRight points', () => {
      const onPercentageChange = jest.fn();
      const { handle } = renderHandle(25, onPercentageChange);

      press(handle, 'End');

      expect(onPercentageChange).toHaveBeenCalledWith(100);
    });

    it('claims the mirrored jump key, so the platform handle does not step it a second time', () => {
      const { handle, platformSteps } = renderHandle(25, () => {});

      press(handle, 'Home');

      expect(platformSteps).not.toHaveBeenCalled();
    });

    it('reports nothing for a jump key pressed at the bound it lands on', () => {
      const onPercentageChange = jest.fn();
      const { handle } = renderHandle(100, onPercentageChange);

      press(handle, 'End');

      expect(onPercentageChange).not.toHaveBeenCalled();
    });

    it('holds a widening arrow to the widest the group may be divided', () => {
      const onPercentageChange = jest.fn();
      const { handle } = renderHandle(98, onPercentageChange);

      press(handle, 'ArrowRight');

      expect(onPercentageChange).toHaveBeenCalledWith(100);
    });

    it('reports nothing for an arrow held down at the end of the range', () => {
      const onPercentageChange = jest.fn();
      const { handle } = renderHandle(100, onPercentageChange);

      press(handle, 'ArrowRight');

      expect(onPercentageChange).not.toHaveBeenCalled();
    });

    it('steps from the width the panel settled at, not the wider one a press was refused', () => {
      const onPercentageChange = jest.fn();

      function Handle({ percentage }: Readonly<{ percentage: number }>) {
        const ref = usePanelResizeKeys(percentage, onPercentageChange);
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        return <div data-testid="handle" ref={ref} role="separator" tabIndex={0} />;
      }
      const { rerender } = render(<Handle percentage={75} />);
      const handle = screen.getByTestId('handle');

      press(handle, 'End');
      expect(onPercentageChange).toHaveBeenCalledWith(100);

      // The group allows only 80 of the 100 asked for, and reports that back.
      rerender(<Handle percentage={80} />);
      onPercentageChange.mockClear();
      press(handle, 'ArrowLeft');

      expect(onPercentageChange).toHaveBeenCalledWith(75);
    });
  });

  describe('jump keys in a left-to-right interface', () => {
    it.each(['Home', 'End'])('leaves %s to the platform handle, which jumps to an end', (key) => {
      const onPercentageChange = jest.fn();
      const { handle, platformSteps } = renderHandle(25, onPercentageChange);

      press(handle, key);

      expect(onPercentageChange).not.toHaveBeenCalled();
      expect(platformSteps).toHaveBeenCalledWith(key);
    });
  });

  describe('keys it does not act on', () => {
    it('leaves the panel alone on a key that resizes nothing', () => {
      const onPercentageChange = jest.fn();
      const { handle } = renderHandle(25, onPercentageChange);

      press(handle, 'a');

      expect(onPercentageChange).not.toHaveBeenCalled();
    });

    it.each(['metaKey', 'altKey', 'ctrlKey'])(
      'leaves a %s-modified arrow for the host to act on',
      (modifier) => {
        document.documentElement.dir = 'rtl';
        const onPercentageChange = jest.fn();
        const { handle, platformSteps } = renderHandle(25, onPercentageChange);

        press(handle, 'ArrowRight', { [modifier]: true });

        expect(onPercentageChange).not.toHaveBeenCalled();
        expect(platformSteps).toHaveBeenCalledWith('ArrowRight');
      },
    );
  });

  it('resizes from the percentage it is given rather than one it remembers', () => {
    // The caller holds the layout, so a percentage changed elsewhere — by a drag, or by a restored
    // layout — is what the next press has to step from.
    document.documentElement.dir = 'rtl';
    const onPercentageChange = jest.fn();

    function Handle({ percentage }: Readonly<{ percentage: number }>) {
      const ref = usePanelResizeKeys(percentage, onPercentageChange);
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      return <div data-testid="handle" ref={ref} role="separator" tabIndex={0} />;
    }
    const { rerender } = render(<Handle percentage={25} />);
    rerender(<Handle percentage={40} />);

    press(screen.getByTestId('handle'), 'ArrowRight');

    expect(onPercentageChange).toHaveBeenCalledWith(45);
  });

  it('stops resizing once the handle it was on has gone', () => {
    // The catalog's handle is unmounted when the panel closes, and a listener left bound to it
    // would keep answering presses for a panel that is no longer there.
    document.documentElement.dir = 'rtl';
    const onPercentageChange = jest.fn();

    function Handle({ present }: Readonly<{ present: boolean }>) {
      const ref = usePanelResizeKeys(25, onPercentageChange);
      return present ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        <div data-testid="handle" ref={ref} role="separator" tabIndex={0} />
      ) : undefined;
    }
    const { rerender } = render(<Handle present />);
    const handle = screen.getByTestId('handle');
    rerender(<Handle present={false} />);

    press(handle, 'ArrowRight');

    expect(onPercentageChange).not.toHaveBeenCalled();
  });
});
