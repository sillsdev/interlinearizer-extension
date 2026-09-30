/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidePanelTabs, { SIDE_PANEL_TAB_STRING_KEYS } from '../../components/SidePanelTabs';

const localizedStrings = Object.fromEntries(SIDE_PANEL_TAB_STRING_KEYS.map((k) => [k, k]));

describe('SidePanelTabs', () => {
  it('marks the list on screen as the selected tab', () => {
    render(
      <SidePanelTabs
        active="concordance"
        localizedStrings={localizedStrings}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByTestId('side-panel-tab-concordance')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('side-panel-tab-catalog')).toHaveAttribute('aria-selected', 'false');
  });

  it('names each list', () => {
    render(
      <SidePanelTabs active="catalog" localizedStrings={localizedStrings} onSelect={() => {}} />,
    );

    expect(screen.getByTestId('side-panel-tab-catalog')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_title%',
    );
    expect(screen.getByTestId('side-panel-tab-concordance')).toHaveTextContent(
      '%interlinearizer_concordance_title%',
    );
  });

  it('asks for the other list when its tab is chosen', async () => {
    const onSelect = jest.fn();
    render(
      <SidePanelTabs active="catalog" localizedStrings={localizedStrings} onSelect={onSelect} />,
    );

    await userEvent.click(screen.getByTestId('side-panel-tab-concordance'));

    expect(onSelect).toHaveBeenCalledWith('concordance');
  });

  it('asks for nothing when the tab on screen is chosen again', async () => {
    const onSelect = jest.fn();
    render(
      <SidePanelTabs active="catalog" localizedStrings={localizedStrings} onSelect={onSelect} />,
    );

    await userEvent.click(screen.getByTestId('side-panel-tab-catalog'));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
