/** @file Unit tests for CreateProjectModal (configures a new draft; does not persist a project). */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { CreateProjectModal } from '../../../components/modals/CreateProjectModal';

describe('CreateProjectModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([
      {
        '%interlinearizer_modal_create_title%': 'Create Interlinear Project',
        '%interlinearizer_modal_create_name_label%': 'Name',
        '%interlinearizer_modal_create_name_placeholder%': 'e.g. My Project',
        '%interlinearizer_modal_create_description_label%': 'Description',
        '%interlinearizer_modal_create_description_placeholder%': 'e.g. My Desc',
        '%interlinearizer_modal_create_language_label%': 'Analysis language (BCP 47)',
        '%interlinearizer_modal_create_language_placeholder%': 'e.g. en',
        '%interlinearizer_modal_create_submit%': 'Create',
        '%interlinearizer_modal_create_cancel%': 'Cancel',
      },
      false,
    ]);
  });

  it('calls onClose when cancel is clicked', async () => {
    const onClose = jest.fn();
    render(<CreateProjectModal onClose={onClose} onCreateDraft={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onCreateDraft with the default language and no name/description', async () => {
    const onCreateDraft = jest.fn();
    render(<CreateProjectModal onClose={() => {}} onCreateDraft={onCreateDraft} />);

    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onCreateDraft).toHaveBeenCalledWith({
      analysisLanguages: ['und'],
      name: undefined,
      description: undefined,
    });
  });

  it('pre-populates the language field from defaultAnalysisLanguage', async () => {
    const onCreateDraft = jest.fn();
    render(
      <CreateProjectModal
        defaultAnalysisLanguage="fr"
        onClose={() => {}}
        onCreateDraft={onCreateDraft}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onCreateDraft).toHaveBeenCalledWith({
      analysisLanguages: ['fr'],
      name: undefined,
      description: undefined,
    });
  });

  it('includes the entered name and description', async () => {
    const onCreateDraft = jest.fn();
    render(<CreateProjectModal onClose={() => {}} onCreateDraft={onCreateDraft} />);

    await userEvent.type(screen.getByLabelText(/^name$/i), 'My Project');
    await userEvent.type(screen.getByLabelText(/^description$/i), 'My Desc');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onCreateDraft).toHaveBeenCalledWith({
      analysisLanguages: ['und'],
      name: 'My Project',
      description: 'My Desc',
    });
  });

  it('parses a comma-separated language list into an array', async () => {
    const onCreateDraft = jest.fn();
    render(<CreateProjectModal onClose={() => {}} onCreateDraft={onCreateDraft} />);

    const languageInput = screen.getByLabelText(/analysis language/i);
    await userEvent.clear(languageInput);
    await userEvent.type(languageInput, 'en, fr, de');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onCreateDraft).toHaveBeenCalledWith({
      analysisLanguages: ['en', 'fr', 'de'],
      name: undefined,
      description: undefined,
    });
  });

  it('defaults the language to ["und"] when the field contains only whitespace', async () => {
    const onCreateDraft = jest.fn();
    render(<CreateProjectModal onClose={() => {}} onCreateDraft={onCreateDraft} />);

    const languageInput = screen.getByLabelText(/analysis language/i);
    await userEvent.clear(languageInput);
    await userEvent.type(languageInput, '   ');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onCreateDraft).toHaveBeenCalledWith({
      analysisLanguages: ['und'],
      name: undefined,
      description: undefined,
    });
  });
});
