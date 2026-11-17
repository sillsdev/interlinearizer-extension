/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import TextReadingStatus from '../../components/TextReadingStatus';

const localizedStrings = {
  '%interlinearizer_textReading_loading%': 'Reading {read} of {total}',
  '%interlinearizer_textReading_error%': 'The text could not be read.',
};

describe('TextReadingStatus', () => {
  it('shows the read as starting until its first status arrives', () => {
    render(
      <TextReadingStatus idPrefix="panel" status={undefined} localizedStrings={localizedStrings} />,
    );

    expect(screen.getByTestId('panel-loading')).toHaveTextContent('Reading 0 of 0');
  });

  it('shows how many books have been read while the text is read', () => {
    render(
      <TextReadingStatus
        idPrefix="panel"
        status={{ failedBookIds: [], booksRead: 12, bookCount: 66 }}
        localizedStrings={localizedStrings}
      />,
    );

    expect(screen.getByTestId('panel-loading')).toHaveTextContent('Reading 12 of 66');
    expect(screen.queryByTestId('panel-error')).not.toBeInTheDocument();
  });

  it('says so when the text could not be read', () => {
    render(
      <TextReadingStatus idPrefix="panel" status="error" localizedStrings={localizedStrings} />,
    );

    expect(screen.getByTestId('panel-error')).toHaveTextContent('The text could not be read.');
    expect(screen.queryByTestId('panel-loading')).not.toBeInTheDocument();
  });

  it('says the text could not be read when a book of it failed to read', () => {
    render(
      <TextReadingStatus
        idPrefix="panel"
        status={{ failedBookIds: ['MRK'], booksRead: 66, bookCount: 66 }}
        localizedStrings={localizedStrings}
      />,
    );

    expect(screen.getByTestId('panel-error')).toHaveTextContent('The text could not be read.');
    expect(screen.queryByTestId('panel-loading')).not.toBeInTheDocument();
  });
});
