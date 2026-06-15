/** @file Unit tests for SaveAsProjectModal. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { SaveAsProjectModal } from '../../../components/modals/SaveAsProjectModal';
import type { InterlinearProjectSummary } from '../../../types/interlinear-project-summary';

const mockSendCommand = jest.mocked(papi.commands.sendCommand);

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_modal_saveAs_title%': 'Save As',
  '%interlinearizer_modal_saveAs_new_section%': 'Save as new project',
  '%interlinearizer_modal_create_name_label%': 'Name',
  '%interlinearizer_modal_create_name_placeholder%': 'e.g. Greek NT glossing',
  '%interlinearizer_modal_create_description_label%': 'Description',
  '%interlinearizer_modal_create_description_placeholder%': 'e.g. Token-level English glosses',
  '%interlinearizer_modal_saveAs_save_new%': 'Save as new',
  '%interlinearizer_modal_saveAs_existing_section%': 'Overwrite an existing project',
  '%interlinearizer_modal_saveAs_none%': 'No existing projects for this source.',
  '%interlinearizer_modal_saveAs_overwrite%': 'Overwrite',
  '%interlinearizer_modal_saveAs_overwrite_confirm_body%': 'Overwrite this project with the draft?',
  '%interlinearizer_modal_saveAs_overwrite_confirm_ok%': 'Overwrite',
  '%interlinearizer_modal_saveAs_overwrite_confirm_cancel%': 'Keep project',
  '%interlinearizer_modal_saveAs_cancel%': 'Cancel',
  '%interlinearizer_modal_select_name_unnamed%': 'Unnamed',
};

const STUB_PROJECT: InterlinearProjectSummary = {
  id: 'proj-uuid',
  createdAt: '2026-01-15T10:30:00.000Z',
  sourceProjectId: 'src-proj',
  analysisLanguages: ['en'],
};

const STUB_PROJECT_2: InterlinearProjectSummary = {
  id: 'proj-uuid-2',
  createdAt: '2026-02-01T08:00:00.000Z',
  sourceProjectId: 'src-proj',
  analysisLanguages: ['fr'],
  name: 'French glosses',
};

const defaultProps = {
  sourceProjectId: 'src-proj',
  onSaveNew: jest.fn(),
  onOverwrite: jest.fn(),
  onClose: jest.fn(),
};

describe('SaveAsProjectModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
    mockSendCommand.mockResolvedValue('[]');
    jest.mocked(papi.notifications.send).mockResolvedValue('mock-notification-id');
  });

  it('loads existing projects for the source on mount', async () => {
    render(<SaveAsProjectModal {...defaultProps} />);

    await waitFor(() =>
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.getProjectsForSource',
        'src-proj',
      ),
    );
  });

  it('prefills the name and description fields from the defaults', async () => {
    render(
      <SaveAsProjectModal
        {...defaultProps}
        defaultName="Draft name"
        defaultDescription="Draft description"
      />,
    );

    expect(screen.getByLabelText('Name')).toHaveValue('Draft name');
    expect(screen.getByLabelText('Description')).toHaveValue('Draft description');
  });

  it('calls onSaveNew with the trimmed name and description', async () => {
    const onSaveNew = jest.fn();
    render(<SaveAsProjectModal {...defaultProps} onSaveNew={onSaveNew} />);

    await userEvent.type(screen.getByLabelText('Name'), '  My Project  ');
    await userEvent.type(screen.getByLabelText('Description'), '  My Description  ');
    await userEvent.click(screen.getByTestId('save-as-new'));

    expect(onSaveNew).toHaveBeenCalledWith('My Project', 'My Description');
  });

  it('calls onSaveNew with undefined when the name and description fields are blank', async () => {
    const onSaveNew = jest.fn();
    render(<SaveAsProjectModal {...defaultProps} onSaveNew={onSaveNew} />);

    await userEvent.type(screen.getByLabelText('Name'), '   ');
    await userEvent.click(screen.getByTestId('save-as-new'));

    expect(onSaveNew).toHaveBeenCalledWith(undefined, undefined);
  });

  it('shows the empty-list message when getProjectsForSource returns no projects', async () => {
    mockSendCommand.mockResolvedValue('[]');
    render(<SaveAsProjectModal {...defaultProps} />);

    await waitFor(() =>
      expect(screen.getByText('No existing projects for this source.')).toBeInTheDocument(),
    );
  });

  it('shows the inline overwrite confirm and calls onOverwrite with the chosen project', async () => {
    const onOverwrite = jest.fn();
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT, STUB_PROJECT_2]));
    render(<SaveAsProjectModal {...defaultProps} onOverwrite={onOverwrite} />);

    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());

    // Each row has its own Overwrite button; click the one in the French glosses row.
    const frenchRow = screen.getByText('French glosses').closest('li');
    if (!frenchRow) throw new Error('expected the French glosses row to be present');
    const { getByRole } = within(frenchRow);
    await userEvent.click(getByRole('button', { name: 'Overwrite' }));

    expect(screen.getByText('Overwrite this project with the draft?')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('save-as-overwrite-confirm'));

    expect(onOverwrite).toHaveBeenCalledWith(STUB_PROJECT_2);
  });

  it('hides the inline overwrite confirm when its Cancel button is clicked', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SaveAsProjectModal {...defaultProps} />);

    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());

    const row = screen.getByText('Unnamed').closest('li');
    if (!row) throw new Error('expected the project row to be present');
    await userEvent.click(within(row).getByRole('button', { name: 'Overwrite' }));
    expect(screen.getByText('Overwrite this project with the draft?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep project' }));

    expect(screen.queryByText('Overwrite this project with the draft?')).not.toBeInTheDocument();
  });

  it('logs and notifies when loading the project list rejects', async () => {
    const loadError = new Error('network error');
    mockSendCommand.mockRejectedValue(loadError);
    render(<SaveAsProjectModal {...defaultProps} />);

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to load projects for Save As',
        loadError,
      ),
    );
    expect(papi.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
  });

  it('calls onClose when the Cancel button is clicked', async () => {
    const onClose = jest.fn();
    render(<SaveAsProjectModal {...defaultProps} onClose={onClose} />);

    // The Cancel button is disabled until the initial load resolves.
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancelButton).not.toBeDisabled());

    await userEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a project-list response that arrives after a newer load has started', async () => {
    let resolveFirst: (v: string) => void = () => {};
    mockSendCommand
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(JSON.stringify([STUB_PROJECT_2]));

    const { rerender } = render(<SaveAsProjectModal {...defaultProps} />);

    // Start a second load by changing sourceProjectId before the first resolves.
    rerender(<SaveAsProjectModal {...defaultProps} sourceProjectId="src-proj-2" />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());

    // Now deliver the stale first response — it must not replace the current list.
    resolveFirst(JSON.stringify([STUB_PROJECT]));

    await waitFor(() => expect(screen.queryByText('Unnamed')).not.toBeInTheDocument());
    expect(screen.getByText('French glosses')).toBeInTheDocument();
  });
});
