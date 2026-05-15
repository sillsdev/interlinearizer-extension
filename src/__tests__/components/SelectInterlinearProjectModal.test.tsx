/** @file Unit tests for SelectInterlinearProjectModal. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import papi from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import {
  SelectInterlinearProjectModal,
  type InterlinearProjectSummary,
} from '../../components/SelectInterlinearProjectModal';

const mockSendCommand = jest.mocked(papi.commands.sendCommand);

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_modal_select_title%': 'Select Interlinear Project',
  '%interlinearizer_modal_select_none%': 'No projects yet.',
  '%interlinearizer_modal_select_create_new%': 'Create New',
  '%interlinearizer_modal_select_cancel%': 'Cancel',
  '%interlinearizer_modal_select_name_unnamed%': 'Unnamed',
  '%interlinearizer_modal_select_info_button_label%': 'Project info',
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
  onSelect: jest.fn(),
  onCreateNew: jest.fn(),
  onClose: jest.fn(),
  onViewInfo: jest.fn(),
};

describe('SelectInterlinearProjectModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
    mockSendCommand.mockResolvedValue('[]');
    jest.mocked(papi.notifications.send).mockResolvedValue('mock-notification-id');
  });

  it('renders nothing while strings are loading', () => {
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, true]);
    const { container } = render(<SelectInterlinearProjectModal {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the modal heading when strings are loaded', () => {
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    expect(
      screen.getByRole('heading', { name: /select interlinear project/i }),
    ).toBeInTheDocument();
  });

  it('shows empty-state message when no projects are returned', async () => {
    mockSendCommand.mockResolvedValue('[]');
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('No projects yet.')).toBeInTheDocument());
  });

  it('shows a project row for each returned project', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT, STUB_PROJECT_2]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());
    expect(screen.getByText('Unnamed')).toBeInTheDocument();
  });

  it('shows the analysis writing system code in each row', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('en')).toBeInTheDocument());
  });

  it('calls onSelect with the project when a project row is clicked', async () => {
    const onSelect = jest.fn();
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SelectInterlinearProjectModal {...defaultProps} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /unnamed/i }));

    expect(onSelect).toHaveBeenCalledWith(STUB_PROJECT);
  });

  it('calls onCreateNew when Create New is clicked', async () => {
    const onCreateNew = jest.fn();
    render(<SelectInterlinearProjectModal {...defaultProps} onCreateNew={onCreateNew} />);

    await userEvent.click(screen.getByRole('button', { name: /create new/i }));

    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = jest.fn();
    render(<SelectInterlinearProjectModal {...defaultProps} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onViewInfo with the project when the info button is clicked', async () => {
    const onViewInfo = jest.fn();
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SelectInterlinearProjectModal {...defaultProps} onViewInfo={onViewInfo} />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /project info/i }));

    expect(onViewInfo).toHaveBeenCalledWith(STUB_PROJECT);
  });

  it('shows the empty-state message when getProjectsForSource command throws, and sends an error notification', async () => {
    mockSendCommand.mockRejectedValue(new Error('network error'));
    render(<SelectInterlinearProjectModal {...defaultProps} />);

    await waitFor(() =>
      expect(papi.notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      ),
    );
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows the empty-state message when getProjectsForSource returns malformed JSON', async () => {
    mockSendCommand.mockResolvedValue('not valid json {{{');
    render(<SelectInterlinearProjectModal {...defaultProps} />);

    await waitFor(() =>
      expect(papi.notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      ),
    );
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('silently drops non-object entries and only renders valid projects', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT, 'bad', 42, undefined]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('bad')).not.toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  });

  it('silently drops entries with a non-string description field', async () => {
    const badDescription = { ...STUB_PROJECT, description: 123 };
    mockSendCommand.mockResolvedValue(JSON.stringify([badDescription, STUB_PROJECT_2]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('silently drops entries with a non-string targetProjectId field', async () => {
    const badTarget = { ...STUB_PROJECT, targetProjectId: 99 };
    mockSendCommand.mockResolvedValue(JSON.stringify([badTarget, STUB_PROJECT_2]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows the empty-state message when getProjectsForSource returns a non-array', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify({ not: 'an array' }));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('No projects yet.')).toBeInTheDocument());
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
