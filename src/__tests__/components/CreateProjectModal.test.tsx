/** @file Unit tests for CreateProjectModal. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import papi from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { CreateProjectModal } from '../../components/CreateProjectModal';

const testProjectId = 'test-project-id';

describe('CreateProjectModal', () => {
  beforeEach(() => {
    jest.mocked(papi.notifications.send).mockResolvedValue('mock-notification-id');
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
  it('renders the heading and analysis language input', () => {
    render(<CreateProjectModal projectId={testProjectId} onClose={() => {}} />);

    expect(
      screen.getByRole('heading', { name: /create interlinear project/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/analysis language/i)).toBeInTheDocument();
  });

  it('calls onClose when cancel is clicked', async () => {
    const onClose = jest.fn();
    render(<CreateProjectModal projectId={testProjectId} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends the createProject command with the projectId and default language when submitted', async () => {
    render(<CreateProjectModal projectId={testProjectId} onClose={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.createProject',
        testProjectId,
        'en',
        undefined,
        undefined,
      ),
    );
  });

  it('sends the createProject command with entered name and description when submitted', async () => {
    render(<CreateProjectModal projectId={testProjectId} onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText(/^name$/i), 'My Project');
    await userEvent.type(screen.getByLabelText(/^description$/i), 'My Desc');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.createProject',
        testProjectId,
        'en',
        'My Project',
        'My Desc',
      ),
    );
  });

  it('sends the createProject command with the entered language when submitted', async () => {
    render(<CreateProjectModal projectId={testProjectId} onClose={() => {}} />);

    const languageInput = screen.getByLabelText(/analysis language/i);
    await userEvent.clear(languageInput);
    await userEvent.type(languageInput, 'fr');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.createProject',
        testProjectId,
        'fr',
        undefined,
        undefined,
      ),
    );
  });

  it('calls onClose after submitting', async () => {
    const onClose = jest.fn();
    render(<CreateProjectModal projectId={testProjectId} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while strings are loading', () => {
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, true]);
    const { container } = render(
      <CreateProjectModal projectId={testProjectId} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onProjectCreated with the new ID and language when sendCommand returns an ID', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue('new-project-id');
    const onProjectCreated = jest.fn();
    render(
      <CreateProjectModal
        projectId={testProjectId}
        onClose={() => {}}
        onProjectCreated={onProjectCreated}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onProjectCreated).toHaveBeenCalledWith('new-project-id', 'en');
  });

  it('does not call onProjectCreated when sendCommand returns undefined', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(undefined);
    const onProjectCreated = jest.fn();
    const onClose = jest.fn();
    render(
      <CreateProjectModal
        projectId={testProjectId}
        onClose={onClose}
        onProjectCreated={onProjectCreated}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onProjectCreated).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose or onProjectCreated when sendCommand rejects, but sends an error notification', async () => {
    jest.mocked(papi.commands.sendCommand).mockRejectedValue(new Error('network error'));
    const onProjectCreated = jest.fn();
    const onClose = jest.fn();
    render(
      <CreateProjectModal
        projectId={testProjectId}
        onClose={onClose}
        onProjectCreated={onProjectCreated}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(papi.notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      ),
    );
    expect(onProjectCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
