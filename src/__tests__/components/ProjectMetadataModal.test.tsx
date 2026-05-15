/** @file Unit tests for ProjectMetadataModal. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import papi from '@papi/frontend';
import { ProjectMetadataModal } from '../../components/ProjectMetadataModal';

const mockSendCommand = jest.mocked(papi.commands.sendCommand);

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_modal_metadata_title%': 'Project Info',
  '%interlinearizer_modal_metadata_id_label%': 'Project ID',
  '%interlinearizer_modal_metadata_name_label%': 'Name',
  '%interlinearizer_modal_metadata_name_placeholder%': 'e.g. Greek NT glossing',
  '%interlinearizer_modal_metadata_description_label%': 'Description',
  '%interlinearizer_modal_metadata_description_placeholder%': 'e.g. Token-level English glosses',
  '%interlinearizer_modal_metadata_analysis_language_label%': 'Analysis Language',
  '%interlinearizer_modal_metadata_language_placeholder%': 'e.g. en',
  '%interlinearizer_modal_metadata_created_label%': 'Created',
  '%interlinearizer_modal_metadata_source_label%': 'Source Project',
  '%interlinearizer_modal_metadata_save%': 'Save',
  '%interlinearizer_modal_metadata_close%': 'Close',
  '%interlinearizer_modal_metadata_delete%': 'Delete',
  '%interlinearizer_modal_metadata_delete_confirm_title%': 'Delete project?',
  '%interlinearizer_modal_metadata_delete_confirm_body%': 'This cannot be undone.',
  '%interlinearizer_modal_metadata_delete_confirm_ok%': 'Delete',
  '%interlinearizer_modal_metadata_delete_confirm_cancel%': 'Cancel',
};

const testProps = {
  interlinearProjectId: 'il-project-uuid',
  sourceProjectId: 'src-project-id',
  analysisLanguages: ['en'],
  createdAt: '2026-01-15T10:30:00.000Z',
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

  it('renders nothing while strings are loading', () => {
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, true]);
    const { container } = render(<ProjectMetadataModal {...testProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the modal heading', () => {
    render(<ProjectMetadataModal {...testProps} />);
    expect(screen.getByRole('heading', { name: /project info/i })).toBeInTheDocument();
  });

  it('displays the interlinear project ID', () => {
    render(<ProjectMetadataModal {...testProps} />);
    expect(screen.getByText('il-project-uuid')).toBeInTheDocument();
  });

  it('displays the source project ID', () => {
    render(<ProjectMetadataModal {...testProps} />);
    expect(screen.getByText('src-project-id')).toBeInTheDocument();
  });

  it('displays the analysis writing system in an editable input', () => {
    render(<ProjectMetadataModal {...testProps} />);
    expect(screen.getByLabelText(/analysis language/i)).toHaveValue('en');
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

  it('passes targetProjectId to sendCommand when the project has a target project', async () => {
    render(<ProjectMetadataModal {...testPropsWithTarget} />);

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.updateProjectMetadata',
        'il-project-uuid',
        undefined,
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
        undefined,
        'New Desc',
        ['en'],
        undefined,
      ),
    );
  });

  it('replaces an existing description when description is cleared and retyped', async () => {
    render(<ProjectMetadataModal {...testProps} description="Old Desc" />);

    const descInput = screen.getByLabelText(/^description$/i);
    await userEvent.clear(descInput);
    await userEvent.type(descInput, 'Replaced');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.updateProjectMetadata',
        'il-project-uuid',
        undefined,
        'Replaced',
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
        undefined,
        undefined,
        ['en'],
        undefined,
      ),
    );
  });

  it('does not call onProjectSaved or onClose when save sendCommand resolves with a falsy value', async () => {
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

  it('sends an error notification when save sendCommand resolves with a falsy value', async () => {
    mockSendCommand.mockResolvedValue(undefined);
    render(<ProjectMetadataModal {...testProps} />);

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(papi.notifications.send).toHaveBeenCalledWith({
        message: '%interlinearizer_error_save_metadata_failed%',
        severity: 'error',
      }),
    );
  });

  it('does not call onProjectSaved, onClose, or send a notification when save sendCommand rejects', async () => {
    mockSendCommand.mockRejectedValue(new Error('save failed'));
    const onProjectSaved = jest.fn();
    const onClose = jest.fn();
    render(
      <ProjectMetadataModal {...testProps} onProjectSaved={onProjectSaved} onClose={onClose} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
    expect(onProjectSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(papi.notifications.send).not.toHaveBeenCalled();
  });

  it('does not call onProjectDeleted, onClose, or send a notification when delete sendCommand rejects', async () => {
    mockSendCommand.mockRejectedValue(new Error('delete failed'));
    const onProjectDeleted = jest.fn();
    const onClose = jest.fn();
    render(
      <ProjectMetadataModal {...testProps} onProjectDeleted={onProjectDeleted} onClose={onClose} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
    expect(onProjectDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(papi.notifications.send).not.toHaveBeenCalled();
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
        undefined,
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

  it('sends the delete command only once when delete-confirm is double-clicked before the first resolves', async () => {
    let resolveCommand: (value: string) => void = () => {};
    mockSendCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCommand = resolve;
        }),
    );
    render(<ProjectMetadataModal {...testProps} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    const confirmButton = screen.getByRole('button', { name: /^delete$/i });
    await userEvent.click(confirmButton);
    await userEvent.click(confirmButton);
    resolveCommand('{}');

    await waitFor(() => expect(mockSendCommand).toHaveBeenCalledTimes(1));
  });

  it('disables the Save button when the language field is empty', async () => {
    render(<ProjectMetadataModal {...testProps} />);

    const langInput = screen.getByLabelText(/analysis language/i);
    await userEvent.clear(langInput);

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('shows delete confirmation when the Delete button is clicked', async () => {
    render(<ProjectMetadataModal {...testProps} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(screen.getByText('Delete project?')).toBeInTheDocument();
  });

  it('hides delete confirmation when Cancel is clicked inside it', async () => {
    render(<ProjectMetadataModal {...testProps} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByText('Delete project?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByText('Delete project?')).not.toBeInTheDocument();
  });

  it('calls deleteProject command when delete is confirmed', async () => {
    render(<ProjectMetadataModal {...testProps} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() =>
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.deleteProject',
        'il-project-uuid',
      ),
    );
  });

  it('calls onProjectDeleted with the project ID after deletion', async () => {
    const onProjectDeleted = jest.fn();
    render(<ProjectMetadataModal {...testProps} onProjectDeleted={onProjectDeleted} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(onProjectDeleted).toHaveBeenCalledWith('il-project-uuid'));
  });

  it('calls onClose after successful deletion', async () => {
    const onClose = jest.fn();
    render(<ProjectMetadataModal {...testProps} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
