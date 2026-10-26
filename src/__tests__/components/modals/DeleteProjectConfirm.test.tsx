/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import papi, { logger } from '@papi/frontend';
import { DeleteProjectConfirm } from '../../../components/modals/DeleteProjectConfirm';
import { mockKeyAsValueLocalizedStrings } from '../test-helpers';

const mockSendCommand = jest.mocked(papi.commands.sendCommand);

const defaultProps = {
  projectId: 'proj-uuid',
  projectName: 'French glosses',
  isPt9Import: false,
  onCancel: jest.fn(),
  onDeleted: jest.fn(),
};

describe('DeleteProjectConfirm', () => {
  beforeEach(() => {
    mockKeyAsValueLocalizedStrings({
      '%interlinearizer_confirm_deleteProject_title%': 'Delete {name}?',
    });
    mockSendCommand.mockResolvedValue(undefined);
  });

  it('names the project in the title', () => {
    render(<DeleteProjectConfirm {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Delete French glosses?' })).toBeInTheDocument();
  });

  it('falls back to the unnamed title for a project without a name', () => {
    render(<DeleteProjectConfirm {...defaultProps} projectName={undefined} />);

    expect(
      screen.getByRole('heading', {
        name: '%interlinearizer_confirm_deleteProject_title_unnamed%',
      }),
    ).toBeInTheDocument();
  });

  it('tells the user that Paratext 9 data is left alone when deleting an import', () => {
    render(<DeleteProjectConfirm {...defaultProps} isPt9Import />);

    expect(
      screen.getByText(/%interlinearizer_confirm_deleteProject_pt9Unaffected%/),
    ).toBeInTheDocument();
  });

  it('leaves Paratext 9 unmentioned when deleting a project that is not an import', () => {
    render(<DeleteProjectConfirm {...defaultProps} />);

    expect(
      screen.queryByText(/%interlinearizer_confirm_deleteProject_pt9Unaffected%/),
    ).not.toBeInTheDocument();
  });

  it('deletes the project and reports it once the user confirms', async () => {
    const onDeleted = jest.fn();
    render(<DeleteProjectConfirm {...defaultProps} onDeleted={onDeleted} />);

    await userEvent.click(screen.getByTestId('delete-project-confirm'));

    expect(mockSendCommand).toHaveBeenCalledWith('interlinearizer.deleteProject', 'proj-uuid');
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('proj-uuid'));
  });

  it('calls onCancel without deleting when Cancel is clicked', async () => {
    const onCancel = jest.fn();
    render(<DeleteProjectConfirm {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_confirm_deleteProject_cancel%' }),
    );

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it('calls onCancel on Escape', async () => {
    const onCancel = jest.fn();
    render(<DeleteProjectConfirm {...defaultProps} onCancel={onCancel} />);

    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('stays open with its buttons enabled after a failed delete, logging the failure', async () => {
    mockSendCommand.mockRejectedValue(new Error('delete failed'));
    const onDeleted = jest.fn();
    render(<DeleteProjectConfirm {...defaultProps} onDeleted={onDeleted} />);

    await userEvent.click(screen.getByTestId('delete-project-confirm'));

    await waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(onDeleted).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('delete-project-confirm')).toBeEnabled());
  });

  it('locks its buttons and ignores Escape while the delete is in flight', async () => {
    let resolveDelete: () => void = () => {};
    mockSendCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = () => resolve(undefined);
        }),
    );
    const onCancel = jest.fn();
    render(<DeleteProjectConfirm {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByTestId('delete-project-confirm'));

    expect(screen.getByTestId('delete-project-confirm')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '%interlinearizer_confirm_deleteProject_cancel%' }),
    ).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();

    resolveDelete();
    await waitFor(() => expect(defaultProps.onDeleted).toHaveBeenCalledTimes(1));
  });
});
