/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import papi, { logger } from '@papi/frontend';
import { ProjectMetadataModal } from '../../../components/modals/ProjectMetadataModal';

const mockSendCommand = jest.mocked(papi.commands.sendCommand);

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_modal_metadata_title%': 'Interlinear info: {projectName}',
  '%interlinearizer_modal_metadata_name_label%': 'Name',
  '%interlinearizer_modal_metadata_name_placeholder%': 'e.g. Greek NT glossing',
  '%interlinearizer_modal_metadata_description_label%': 'Description',
  '%interlinearizer_modal_metadata_description_placeholder%': 'e.g. Word-level English glosses',
  '%interlinearizer_modal_metadata_analysis_language_label%': 'Analysis Language',
  '%interlinearizer_modal_metadata_language_placeholder%': 'e.g. en',
  '%interlinearizer_modal_metadata_created_label%': 'Created',
  '%interlinearizer_modal_metadata_modified_label%': 'Modified',
  '%interlinearizer_modal_metadata_save%': 'Save',
  '%interlinearizer_modal_metadata_close%': 'Close',
  '%interlinearizer_modal_metadata_lastSynced_label%': 'Last synced',
  '%interlinearizer_confirm_deleteProject_title%': 'Delete {name}?',
  '%interlinearizer_confirm_deleteProject_title_unnamed%': 'Delete unnamed project?',
  '%interlinearizer_confirm_deleteProject_body%': 'Permanently delete this interlinear data?',
  '%interlinearizer_confirm_deleteProject_pt9Unaffected%': 'No Paratext 9 data will be affected.',
  '%interlinearizer_confirm_deleteProject_ok%': 'Delete',
  '%interlinearizer_confirm_deleteProject_cancel%': 'Cancel',
  '%interlinearizer_confirm_removeLanguages_title%': 'Remove languages that have glosses?',
  '%interlinearizer_confirm_removeLanguages_body%': 'Removing these languages hides their glosses:',
  '%interlinearizer_confirm_removeLanguages_count_glosses%': '{language}: {glosses} glosses',
  '%interlinearizer_confirm_removeLanguages_count_freeTranslations%':
    '{language}: {freeTranslations} free translations',
  '%interlinearizer_confirm_removeLanguages_count_both%':
    '{language}: {glosses} glosses and {freeTranslations} free translations',
  '%interlinearizer_confirm_removeLanguages_kept%': 'The glosses stay in the project.',
  '%interlinearizer_confirm_removeLanguages_ok%': 'Remove',
  '%interlinearizer_confirm_removeLanguages_cancel%': 'Keep editing',
};

const testProps = {
  interlinearProjectId: 'il-project-uuid',
  name: 'Old Name',
  sourceShortName: 'SRC',
  analysisLanguages: ['en'],
  createdAt: '2026-01-15T10:30:00.000Z',
  updatedAt: '2026-01-20T14:00:00.000Z',
  onClose: jest.fn(),
  onProjectSaved: jest.fn(),
  onProjectDeleted: jest.fn(),
};

const testPropsWithTarget = {
  ...testProps,
  targetProjectId: 'target-project-id',
};

describe('ProjectMetadataModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
    mockSendCommand.mockResolvedValue('{}');
    jest.mocked(papi.notifications.send).mockResolvedValue('mock-notification-id');
  });

  it("titles the modal with the source project's short name", () => {
    render(<ProjectMetadataModal {...testProps} />);
    expect(screen.getByRole('heading', { name: 'Interlinear info: SRC' })).toBeInTheDocument();
  });

  it('leaves out the interlinear project ID', () => {
    render(<ProjectMetadataModal {...testProps} />);
    expect(screen.queryByText('il-project-uuid')).not.toBeInTheDocument();
  });

  it('displays the analysis writing system in an editable input', () => {
    render(<ProjectMetadataModal {...testProps} />);
    expect(screen.getByLabelText(/analysis language/i)).toHaveValue('en');
  });

  it('displays the locale-formatted modified date', () => {
    render(<ProjectMetadataModal {...testProps} />);
    const expectedDate = new Date(testProps.updatedAt).toLocaleString();
    expect(screen.getByText(expectedDate)).toBeInTheDocument();
  });

  it('calls onClose when the Close button is clicked', async () => {
    const onClose = jest.fn();
    render(<ProjectMetadataModal {...testProps} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /^close$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls sendCommand with updated values when Save is clicked', async () => {
    render(<ProjectMetadataModal {...testProps} name="Old Name" />);

    const nameInput = screen.getByLabelText(/^name$/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Name');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.updateProjectMetadata',
        'il-project-uuid',
        'New Name',
        undefined,
        ['en'],
        undefined,
      ),
    );
  });

  it('keeps the stored languages in the project and hands the edited ones to the caller', async () => {
    const onProjectSaved = jest.fn();
    render(
      <ProjectMetadataModal
        {...testProps}
        storedAnalysisLanguages={['de']}
        onProjectSaved={onProjectSaved}
      />,
    );

    const languagesInput = screen.getByLabelText(/analysis language/i);
    await userEvent.clear(languagesInput);
    await userEvent.type(languagesInput, 'fr');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onProjectSaved).toHaveBeenCalled());
    expect(mockSendCommand).toHaveBeenCalledWith(
      'interlinearizer.updateProjectMetadata',
      'il-project-uuid',
      expect.any(String),
      undefined,
      ['de'],
      undefined,
    );
    expect(onProjectSaved.mock.calls[0][0]).toMatchObject({ analysisLanguages: ['fr'] });
  });

  it('passes targetProjectId to sendCommand when the project has a target project', async () => {
    render(<ProjectMetadataModal {...testPropsWithTarget} />);

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.updateProjectMetadata',
        'il-project-uuid',
        'Old Name',
        undefined,
        ['en'],
        'target-project-id',
      ),
    );
  });

  it('calls onProjectSaved with updated fields after a successful save', async () => {
    const onProjectSaved = jest.fn();
    render(
      <ProjectMetadataModal
        {...testProps}
        name="Old Name"
        description="Old Desc"
        onProjectSaved={onProjectSaved}
      />,
    );

    const nameInput = screen.getByLabelText(/^name$/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Name');
    const langInput = screen.getByLabelText(/analysis language/i);
    await userEvent.clear(langInput);
    await userEvent.type(langInput, 'fr');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(onProjectSaved).toHaveBeenCalledWith({
        name: 'New Name',
        description: 'Old Desc',
        analysisLanguages: ['fr'],
      }),
    );
  });

  it('threads the server-refreshed updatedAt from the returned project into onProjectSaved', async () => {
    mockSendCommand.mockResolvedValue(
      JSON.stringify({ id: 'il-project-uuid', updatedAt: '2026-06-15T09:00:00.000Z' }),
    );
    const onProjectSaved = jest.fn();
    render(<ProjectMetadataModal {...testProps} onProjectSaved={onProjectSaved} />);

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(onProjectSaved).toHaveBeenCalledWith(
        expect.objectContaining({ updatedAt: '2026-06-15T09:00:00.000Z' }),
      ),
    );
  });

  it('omits updatedAt from onProjectSaved when the returned project has none', async () => {
    // The default mock returns '{}', so no updatedAt is present to thread through.
    const onProjectSaved = jest.fn();
    render(<ProjectMetadataModal {...testProps} onProjectSaved={onProjectSaved} />);

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onProjectSaved).toHaveBeenCalled());
    expect(onProjectSaved.mock.calls[0][0]).not.toHaveProperty('updatedAt');
  });

  it('calls onClose after a successful save', async () => {
    const onClose = jest.fn();
    render(<ProjectMetadataModal {...testProps} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('calls sendCommand with updated description when description is changed', async () => {
    render(<ProjectMetadataModal {...testProps} />);

    const descInput = screen.getByLabelText(/^description$/i);
    await userEvent.type(descInput, 'New Desc');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.updateProjectMetadata',
        'il-project-uuid',
        'Old Name',
        'New Desc',
        ['en'],
        undefined,
      ),
    );
  });

  it('sends undefined description when description is cleared', async () => {
    render(<ProjectMetadataModal {...testProps} description="Old Desc" />);

    const descInput = screen.getByLabelText(/^description$/i);
    await userEvent.clear(descInput);
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.updateProjectMetadata',
        'il-project-uuid',
        'Old Name',
        undefined,
        ['en'],
        undefined,
      ),
    );
  });

  it('does not call onProjectSaved or onClose when save sendCommand resolves with undefined (project not found)', async () => {
    mockSendCommand.mockResolvedValue(undefined);
    const onProjectSaved = jest.fn();
    const onClose = jest.fn();
    render(
      <ProjectMetadataModal {...testProps} onProjectSaved={onProjectSaved} onClose={onClose} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
    expect(onProjectSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('logs the failure and does not call onProjectSaved or onClose when save sendCommand rejects', async () => {
    mockSendCommand.mockRejectedValue(new Error('save failed'));
    const onProjectSaved = jest.fn();
    const onClose = jest.fn();
    render(
      <ProjectMetadataModal {...testProps} onProjectSaved={onProjectSaved} onClose={onClose} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(jest.mocked(logger.error)).toHaveBeenCalled());
    expect(onProjectSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('trims whitespace from the language input before saving', async () => {
    render(<ProjectMetadataModal {...testProps} />);

    const langInput = screen.getByLabelText(/analysis language/i);
    await userEvent.clear(langInput);
    await userEvent.type(langInput, '  fr  ');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.updateProjectMetadata',
        'il-project-uuid',
        'Old Name',
        undefined,
        ['fr'],
        undefined,
      ),
    );
  });

  it('sends the save command only once when Save is double-clicked before the first resolves', async () => {
    let resolveCommand: (value: string) => void = () => {};
    mockSendCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCommand = resolve;
        }),
    );
    render(<ProjectMetadataModal {...testProps} />);

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    await userEvent.click(saveButton);
    await userEvent.click(saveButton);
    resolveCommand('{}');

    await waitFor(() => expect(mockSendCommand).toHaveBeenCalledTimes(1));
  });

  it('disables the Save button for an unnamed project until a name is entered', async () => {
    render(<ProjectMetadataModal {...testProps} name={undefined} />);

    const nameInput = screen.getByLabelText(/^name$/i);
    expect(nameInput).toHaveValue('');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();

    await userEvent.type(nameInput, 'Named');

    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
  });

  it('disables the fields and the Save button while saving is blocked', () => {
    render(<ProjectMetadataModal {...testProps} isSaveBlocked />);

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByLabelText(/^name$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^description$/i)).toBeDisabled();
    expect(screen.getByLabelText(/analysis language/i)).toBeDisabled();
  });

  it('disables the Save button when the name field is empty', async () => {
    render(<ProjectMetadataModal {...testProps} />);

    await userEvent.clear(screen.getByLabelText(/^name$/i));

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('disables the Save button when the name field is only whitespace', async () => {
    render(<ProjectMetadataModal {...testProps} />);

    const nameInput = screen.getByLabelText(/^name$/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, '   ');

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('disables the Save button when the language field is empty', async () => {
    render(<ProjectMetadataModal {...testProps} />);

    const langInput = screen.getByLabelText(/analysis language/i);
    await userEvent.clear(langInput);

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('offers no Delete button', () => {
    render(<ProjectMetadataModal {...testProps} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  describe('removing secondary analysis languages', () => {
    /** Renders the modal for a project in `en, de, fr`, then saves it with only `en`. */
    async function saveWithoutSecondaries(countText?: jest.Mock) {
      render(
        <ProjectMetadataModal
          {...testProps}
          analysisLanguages={['en', 'de', 'fr']}
          countText={countText}
        />,
      );
      const langInput = screen.getByLabelText(/analysis language/i);
      await userEvent.clear(langInput);
      await userEvent.type(langInput, 'en');
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    }

    /** Whether Project Info sent its save. */
    function saved() {
      return mockSendCommand.mock.calls.some(
        ([command]) => command === 'interlinearizer.updateProjectMetadata',
      );
    }

    it('says how many glosses each removed language has before saving', async () => {
      const countText = jest.fn().mockResolvedValue({
        de: { glosses: 3, freeTranslations: 0 },
        fr: { glosses: 0, freeTranslations: 0 },
      });
      await saveWithoutSecondaries(countText);

      expect(await screen.findByTestId('remove-languages-counts')).toHaveTextContent(
        'de: 3 glosses',
      );
      expect(screen.getByTestId('remove-languages-counts')).not.toHaveTextContent('fr');
      expect(countText).toHaveBeenCalledWith(['de', 'fr']);
      expect(saved()).toBe(false);
    });

    it('warns about a removed language that has only free translations', async () => {
      await saveWithoutSecondaries(
        jest.fn().mockResolvedValue({
          de: { glosses: 0, freeTranslations: 2 },
          fr: { glosses: 0, freeTranslations: 0 },
        }),
      );

      expect(await screen.findByTestId('remove-languages-counts')).toHaveTextContent(
        'de: 2 free translations',
      );
      expect(saved()).toBe(false);
    });

    it('holds the fields while it counts', async () => {
      await saveWithoutSecondaries(jest.fn(() => new Promise(() => {})));

      expect(screen.getByLabelText(/analysis language/i)).toBeDisabled();
      expect(screen.getByLabelText(/^name$/i)).toBeDisabled();
      expect(screen.getByLabelText(/^description$/i)).toBeDisabled();
    });

    it('saves once the user confirms the removal', async () => {
      await saveWithoutSecondaries(
        jest.fn().mockResolvedValue({ de: { glosses: 3, freeTranslations: 0 } }),
      );

      await userEvent.click(await screen.findByTestId('remove-languages-confirm'));

      await waitFor(() =>
        expect(mockSendCommand).toHaveBeenCalledWith(
          'interlinearizer.updateProjectMetadata',
          'il-project-uuid',
          'Old Name',
          undefined,
          ['en'],
          undefined,
        ),
      );
      expect(screen.queryByTestId('remove-languages-modal-title')).not.toBeInTheDocument();
    });

    it('goes back to the form without saving when the user cancels', async () => {
      await saveWithoutSecondaries(
        jest.fn().mockResolvedValue({ de: { glosses: 3, freeTranslations: 0 } }),
      );

      await userEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));

      expect(screen.queryByTestId('remove-languages-modal-title')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/analysis language/i)).toHaveValue('en');
      expect(saved()).toBe(false);
    });

    it('saves without asking when the removed languages have no glosses', async () => {
      await saveWithoutSecondaries(jest.fn().mockResolvedValue({}));

      await waitFor(() => expect(saved()).toBe(true));
      expect(screen.queryByTestId('remove-languages-modal-title')).not.toBeInTheDocument();
    });

    it('logs a failed count and saves without asking', async () => {
      await saveWithoutSecondaries(jest.fn().mockRejectedValue(new Error('unreadable')));

      await waitFor(() => expect(saved()).toBe(true));
      expect(logger.warn).toHaveBeenCalledWith(
        'Interlinearizer: failed to count the text of removed languages',
        expect.any(Error),
      );
    });

    it('saves without asking when it has no way to count glosses', async () => {
      await saveWithoutSecondaries();

      await waitFor(() => expect(saved()).toBe(true));
    });

    it("doesn't count the glosses of a removed primary language", async () => {
      const countText = jest.fn().mockResolvedValue({ en: { glosses: 5, freeTranslations: 0 } });
      render(
        <ProjectMetadataModal
          {...testProps}
          analysisLanguages={['en', 'de']}
          countText={countText}
        />,
      );
      const langInput = screen.getByLabelText(/analysis language/i);
      await userEvent.clear(langInput);
      await userEvent.type(langInput, 'de');
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => expect(saved()).toBe(true));
      expect(countText).not.toHaveBeenCalled();
    });
  });
});

describe('ProjectMetadataModal read-only (Paratext 9 import)', () => {
  const importProps = {
    ...testProps,
    name: 'Paratext 9 Interlinear',
    description: 'Imported from Paratext 9.',
    pt9ImportedAt: '2026-08-01T12:00:00.000Z',
  };

  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
    mockSendCommand.mockResolvedValue('{}');
    jest.mocked(papi.notifications.send).mockResolvedValue('mock-notification-id');
  });

  it('renders name, description, and languages as static text with no Save', () => {
    render(<ProjectMetadataModal {...importProps} />);

    const staticFields = screen.getByTestId('metadata-readonly-fields');
    expect(staticFields).toHaveTextContent('Paratext 9 Interlinear');
    expect(staticFields).toHaveTextContent('Imported from Paratext 9.');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('renders empty static rows when the import has no name or description', () => {
    render(
      <ProjectMetadataModal
        {...testProps}
        name={undefined}
        pt9ImportedAt="2026-08-01T12:00:00.000Z"
      />,
    );

    expect(screen.getByTestId('metadata-readonly-fields')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the last-synced time', () => {
    render(<ProjectMetadataModal {...importProps} />);
    expect(screen.getByText('Last synced')).toBeInTheDocument();
  });
});
