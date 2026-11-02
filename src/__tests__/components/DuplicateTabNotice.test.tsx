/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DuplicateTabNotice from '../../components/DuplicateTabNotice';
import { mockKeyAsValueLocalizedStrings } from './test-helpers';

beforeEach(() => mockKeyAsValueLocalizedStrings());

describe('DuplicateTabNotice', () => {
  it('says the project is open in another tab', () => {
    render(<DuplicateTabNotice webViewId="tab-b" />);

    expect(screen.getByText('%interlinearizer_duplicateTab_title%')).toBeInTheDocument();
    expect(screen.getByText('%interlinearizer_duplicateTab_description%')).toBeInTheDocument();
  });

  it('takes the reader to the tab that holds the project', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue('tab-a');
    render(<DuplicateTabNotice webViewId="tab-b" />);

    await userEvent.click(screen.getByText('%interlinearizer_duplicateTab_goToTab%'));

    expect(papi.commands.sendCommand).toHaveBeenCalledWith(
      'interlinearizer.openForWebView',
      'tab-b',
    );
  });

  it('logs a tab it could not take the reader to', async () => {
    jest.mocked(papi.commands.sendCommand).mockRejectedValue(new Error('gone'));
    render(<DuplicateTabNotice webViewId="tab-b" />);

    await userEvent.click(screen.getByText('%interlinearizer_duplicateTab_goToTab%'));

    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: could not go to the open tab',
      expect.any(Error),
    );
  });

  it('shows nothing until its strings load', () => {
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, true]);

    const { container } = render(<DuplicateTabNotice webViewId="tab-b" />);

    expect(container).toBeEmptyDOMElement();
  });
});
