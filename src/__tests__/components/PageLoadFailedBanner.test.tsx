/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PageLoadFailedBanner from '../../components/PageLoadFailedBanner';
import type { PageFailure } from '../../types/segment-pages';
import { mockKeyAsValueLocalizedStrings } from './test-helpers';

const FAILED: PageFailure = { cause: 'app', isRetrying: false, failedAgain: false };

beforeEach(() =>
  mockKeyAsValueLocalizedStrings({
    '%interlinearizer_pageLoad_failed%': '%interlinearizer_pageLoad_failed% {places}',
    '%interlinearizer_pageLoad_failedAgain%': '%interlinearizer_pageLoad_failedAgain% {places}',
    '%interlinearizer_pageLoad_retrying%': '%interlinearizer_pageLoad_retrying% {places}',
  }),
);

describe('PageLoadFailedBanner', () => {
  it('names the verses that could not be loaded', () => {
    render(<PageLoadFailedBanner failure={FAILED} onRetry={jest.fn()} places="Joshua 13:18" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '%interlinearizer_pageLoad_failed% Joshua 13:18',
    );
  });

  it.each([
    ['text', '%interlinearizer_pageLoad_cause_text%'],
    ['analysis', '%interlinearizer_pageLoad_cause_analysis%'],
    ['app', '%interlinearizer_pageLoad_cause_app%'],
  ] as const)('says broadly why the verses could not be loaded, for a %s failure', (cause, key) => {
    render(
      <PageLoadFailedBanner
        failure={{ ...FAILED, cause }}
        onRetry={jest.fn()}
        places="Joshua 13:18"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(key);
  });

  it('says that the verses still could not be loaded after trying again', () => {
    render(
      <PageLoadFailedBanner
        failure={{ ...FAILED, failedAgain: true }}
        onRetry={jest.fn()}
        places="Joshua 13:18"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '%interlinearizer_pageLoad_failedAgain% Joshua 13:18',
    );
  });

  it('says that it is trying again, without the cause of the failure before', () => {
    render(
      <PageLoadFailedBanner
        failure={{ ...FAILED, isRetrying: true }}
        onRetry={jest.fn()}
        places="Joshua 13:18"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('%interlinearizer_pageLoad_retrying% Joshua 13:18');
    expect(alert).not.toHaveTextContent('%interlinearizer_pageLoad_cause_app%');
  });

  it('disables trying again while it is trying again', () => {
    render(
      <PageLoadFailedBanner
        failure={{ ...FAILED, isRetrying: true }}
        onRetry={jest.fn()}
        places="Joshua 13:18"
      />,
    );

    expect(screen.getByRole('button', { name: '%interlinearizer_pageLoad_retry%' })).toBeDisabled();
  });

  it('asks for the text again when the reader asks to try again', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    render(<PageLoadFailedBanner failure={FAILED} onRetry={onRetry} places="Joshua 13:18" />);

    await user.click(screen.getByRole('button', { name: '%interlinearizer_pageLoad_retry%' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
