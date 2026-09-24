/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { fireEvent, render, screen } from '@testing-library/react';
import { AltHoverTooltip } from '../../components/AltHoverTooltip';
import { withTooltipProvider } from './test-helpers';

/** Renders an {@link AltHoverTooltip} around a test trigger. */
function renderTooltip(content: string | undefined) {
  render(
    withTooltipProvider(
      <AltHoverTooltip content={content}>
        {(onMouseMove) => (
          <span data-testid="trigger" onMouseMove={onMouseMove}>
            gap
          </span>
        )}
      </AltHoverTooltip>,
    ),
  );
}

describe('AltHoverTooltip', () => {
  it('mounts no tooltip before the trigger is hovered', () => {
    renderTooltip('Split');
    expect(screen.getByTestId('trigger')).not.toHaveAttribute('title');
  });

  it('mounts no tooltip for a hover without Alt', () => {
    renderTooltip('Split');
    fireEvent.mouseMove(screen.getByTestId('trigger'), { altKey: false });
    expect(screen.getByTestId('trigger')).not.toHaveAttribute('title');
  });

  it('mounts the tooltip once the trigger is hovered with Alt held', () => {
    renderTooltip('Split');
    fireEvent.mouseMove(screen.getByTestId('trigger'), { altKey: true });
    expect(screen.getByTestId('trigger')).toHaveAttribute('title', 'Split');
  });

  it('opens the tooltip on mount, since the arming hover preceded its trigger', () => {
    renderTooltip('Split');
    fireEvent.mouseMove(screen.getByTestId('trigger'), { altKey: true });
    expect(screen.getByTestId('trigger')).toHaveAttribute('data-tooltip-default-open', 'true');
  });

  it('mounts no tooltip without content', () => {
    renderTooltip(undefined);
    fireEvent.mouseMove(screen.getByTestId('trigger'), { altKey: true });
    expect(screen.getByTestId('trigger')).not.toHaveAttribute('title');
  });
});
