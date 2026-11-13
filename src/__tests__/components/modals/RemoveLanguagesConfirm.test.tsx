/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { RemoveLanguagesConfirm } from '../../../components/modals/RemoveLanguagesConfirm';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_confirm_removeLanguages_title%': 'Remove analysis languages?',
  '%interlinearizer_confirm_removeLanguages_body%': 'Their text becomes inaccessible:',
  '%interlinearizer_confirm_removeLanguages_count_glosses%': '{language}: {glosses} glosses',
  '%interlinearizer_confirm_removeLanguages_count_freeTranslations%':
    '{language}: {freeTranslations} free translations',
  '%interlinearizer_confirm_removeLanguages_count_both%':
    '{language}: {glosses} glosses and {freeTranslations} free translations',
  '%interlinearizer_confirm_removeLanguages_kept%': 'It stays in the project.',
  '%interlinearizer_confirm_removeLanguages_ok%': 'Remove',
  '%interlinearizer_confirm_removeLanguages_cancel%': 'Cancel',
};

const defaultProps = {
  textCounts: [['de', { glosses: 3, freeTranslations: 0 }]] as const,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

describe('RemoveLanguagesConfirm', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('renders the title, body, and note that the text stays', () => {
    render(<RemoveLanguagesConfirm {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Remove analysis languages?' })).toBeInTheDocument();
    expect(screen.getByText('Their text becomes inaccessible:')).toBeInTheDocument();
    expect(screen.getByText('It stays in the project.')).toBeInTheDocument();
  });

  it('lists each language with only the kinds of text it has', () => {
    render(
      <RemoveLanguagesConfirm
        {...defaultProps}
        textCounts={[
          ['de', { glosses: 3, freeTranslations: 0 }],
          ['fr', { glosses: 0, freeTranslations: 2 }],
          ['es', { glosses: 1, freeTranslations: 4 }],
        ]}
      />,
    );

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'de: 3 glosses',
      'fr: 2 free translations',
      'es: 1 glosses and 4 free translations',
    ]);
  });

  it('calls onConfirm when Remove is clicked', async () => {
    const onConfirm = jest.fn();
    render(<RemoveLanguagesConfirm {...defaultProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('remove-languages-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = jest.fn();
    render(<RemoveLanguagesConfirm {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
