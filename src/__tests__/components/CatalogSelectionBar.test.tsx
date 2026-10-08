/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import CatalogSelectionBar, {
  SELECTION_BAR_STRING_KEYS,
} from '../../components/CatalogSelectionBar';

/** Each key resolving to itself, but the summary resolving to a template its counts fill in. */
const STRINGS = {
  ...Object.fromEntries(SELECTION_BAR_STRING_KEYS.map((k) => [k, k])),
  '%interlinearizer_analysisCatalog_checkedSummary%': '{count} checked, {usageCount} uses',
};

/** The bar with every callback stubbed and nothing checked unless a test says otherwise. */
function renderBar(overrides: Partial<ComponentProps<typeof CatalogSelectionBar>> = {}) {
  const props = {
    count: 0,
    usageCount: 0,
    allChecked: false,
    onCheckAll: jest.fn(),
    onClearGloss: jest.fn(),
    onDelete: jest.fn(),
    localizedStrings: STRINGS,
    ...overrides,
  };
  render(<CatalogSelectionBar {...props} />);
  return props;
}

describe('CatalogSelectionBar', () => {
  it('offers only the control checking every row while nothing is checked', () => {
    renderBar();

    expect(screen.getByTestId('catalog-check-all')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-selection-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('catalog-selection-delete')).not.toBeInTheDocument();
  });

  it('states how many rows are checked and how many uses they have', () => {
    renderBar({ count: 2, usageCount: 7 });

    expect(screen.getByTestId('catalog-selection-summary')).toHaveTextContent('2 checked, 7 uses');
  });

  it('asks for every row to be checked when not all are', async () => {
    const { onCheckAll } = renderBar({ count: 1 });

    await userEvent.click(screen.getByTestId('catalog-check-all'));

    expect(onCheckAll).toHaveBeenCalledWith(true);
  });

  it('asks for every row to be unchecked when all are', async () => {
    const { onCheckAll } = renderBar({ count: 3, allChecked: true });

    await userEvent.click(screen.getByTestId('catalog-check-all'));

    expect(onCheckAll).toHaveBeenCalledWith(false);
  });

  it('clears the checked rows’ glosses', async () => {
    const { onClearGloss } = renderBar({ count: 2 });

    await userEvent.click(screen.getByTestId('catalog-selection-clear-gloss'));

    expect(onClearGloss).toHaveBeenCalled();
  });

  it('deletes the checked rows', async () => {
    const { onDelete } = renderBar({ count: 2 });

    await userEvent.click(screen.getByTestId('catalog-selection-delete'));

    expect(onDelete).toHaveBeenCalled();
  });

  it('opens a merge of the checked rows when they can be merged', async () => {
    const onMerge = jest.fn();
    renderBar({ count: 2, onMerge });

    await userEvent.click(screen.getByTestId('catalog-selection-merge'));

    expect(onMerge).toHaveBeenCalled();
  });

  it('offers no merge when the checked rows cannot be merged', () => {
    renderBar({ count: 2 });

    expect(screen.queryByTestId('catalog-selection-merge')).not.toBeInTheDocument();
  });
});
