/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import TextReadingStatus from '../../components/TextReadingStatus';

const localizedStrings = {
  '%interlinearizer_concordance_loading%': 'Reading {read} of {total}',
  '%interlinearizer_concordance_error%': 'The text could not be read.',
};

describe('TextReadingStatus', () => {
  it('shows how many books have been read while the text is read', () => {
    render(
      <TextReadingStatus
        idPrefix="panel"
        index={{ status: 'loading', booksRead: 12, bookCount: 66 }}
        localizedStrings={localizedStrings}
      />,
    );

    expect(screen.getByTestId('panel-loading')).toHaveTextContent('Reading 12 of 66');
    expect(screen.queryByTestId('panel-error')).not.toBeInTheDocument();
  });

  it('says so when the text could not be read', () => {
    render(
      <TextReadingStatus
        idPrefix="panel"
        index={{ status: 'error', booksRead: 0, bookCount: 66 }}
        localizedStrings={localizedStrings}
      />,
    );

    expect(screen.getByTestId('panel-error')).toHaveTextContent('The text could not be read.');
    expect(screen.queryByTestId('panel-loading')).not.toBeInTheDocument();
  });
});
