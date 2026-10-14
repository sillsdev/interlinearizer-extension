/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import LocalizedTooltip from '../../components/LocalizedTooltip';
import { withTooltipProvider } from './test-helpers';

function renderTooltip(label: string) {
  render(
    withTooltipProvider(
      <LocalizedTooltip label={label}>
        <span data-testid="trigger">3</span>
      </LocalizedTooltip>,
    ),
  );
}

describe('LocalizedTooltip', () => {
  it('shows the label on its trigger', () => {
    renderTooltip('uses');

    expect(screen.getByTestId('trigger')).toHaveAttribute('title', 'uses');
  });

  it('shows nothing while the label is an unresolved key', () => {
    renderTooltip('%interlinearizer_analysisCatalog_usageCount%');

    expect(screen.getByTestId('trigger')).not.toHaveAttribute('title');
  });
});
