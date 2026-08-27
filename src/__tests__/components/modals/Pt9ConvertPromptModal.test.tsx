/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Pt9ConvertPromptModal } from '../../../components/modals/Pt9ConvertPromptModal';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_pt9ImportModal_title%': 'Import from Paratext 9',
  '%interlinearizer_pt9ConvertPrompt_message%':
    'This project has Paratext 9 interlinear data. Would you like to convert it now?',
  '%interlinearizer_pt9ConvertPrompt_yes%': 'Yes',
  '%interlinearizer_pt9ConvertPrompt_no%': 'No',
};

describe('Pt9ConvertPromptModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('renders the import title, the offer message, and both answers', () => {
    render(<Pt9ConvertPromptModal onYes={jest.fn()} onNo={jest.fn()} />);

    expect(screen.getByTestId('pt9-convert-prompt-title')).toHaveTextContent(
      'Import from Paratext 9',
    );
    expect(screen.getByTestId('pt9-convert-prompt-message')).toHaveTextContent(
      'This project has Paratext 9 interlinear data. Would you like to convert it now?',
    );
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
  });

  it('answers Yes', async () => {
    const onYes = jest.fn();
    render(<Pt9ConvertPromptModal onYes={onYes} onNo={jest.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));

    expect(onYes).toHaveBeenCalledTimes(1);
  });

  it('answers No', async () => {
    const onNo = jest.fn();
    render(<Pt9ConvertPromptModal onYes={jest.fn()} onNo={onNo} />);

    await userEvent.click(screen.getByRole('button', { name: 'No' }));

    expect(onNo).toHaveBeenCalledTimes(1);
  });
});
