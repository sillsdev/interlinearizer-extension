/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import papi from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { CopyToEditableModal } from '../../../components/modals/CopyToEditableModal';
import { makeProjectSummary } from '../../test-helpers';

const mockSendCommand = jest.mocked(papi.commands.sendCommand);

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_copyModal_title%': 'Copy to editable project',
  '%interlinearizer_copyModal_defaultName%': 'Copy of Paratext 9 Interlinear',
  '%interlinearizer_copyModal_defaultNameNumbered%': 'Copy ({number}) of Paratext 9 Interlinear',
  '%interlinearizer_copyModal_create%': 'Create copy',
  '%interlinearizer_copyModal_cancel%': 'Cancel',
  '%interlinearizer_copyModal_info%': 'Later Paratext 9 changes stay out of the copy.',
  '%interlinearizer_modal_metadata_name_label%': 'Name',
  '%interlinearizer_modal_metadata_description_label%': 'Description',
};

describe('CopyToEditableModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
    mockSendCommand.mockResolvedValue('[]');
  });

  /** Resolves the project-list load with projects bearing `names`. */
  function mockProjectNames(...names: string[]): void {
    mockSendCommand.mockResolvedValue(
      JSON.stringify(names.map((name, i) => makeProjectSummary({ id: `proj-${i}`, name }))),
    );
  }

  /** Renders the modal and lets the project-list load settle. */
  async function renderModal({
    isSubmitting = false,
    onSubmit = jest.fn(),
    onClose = jest.fn(),
  }: Partial<Parameters<typeof CopyToEditableModal>[0]> = {}): Promise<void> {
    await act(async () => {
      render(
        <CopyToEditableModal
          sourceProjectId="src-proj"
          isSubmitting={isSubmitting}
          onSubmit={onSubmit}
          onClose={onClose}
        />,
      );
    });
  }

  it('prefills the name with the localized default', async () => {
    await renderModal();

    expect(screen.getByLabelText('Name')).toHaveValue('Copy of Paratext 9 Interlinear');
  });

  it('numbers the default past every name a project of the source already bears', async () => {
    mockProjectNames(
      'Copy of Paratext 9 Interlinear',
      'Copy (2) of Paratext 9 Interlinear',
      'Paratext 9 Interlinear',
    );
    await renderModal();

    expect(screen.getByLabelText('Name')).toHaveValue('Copy (3) of Paratext 9 Interlinear');
  });

  it('keeps the unnumbered default when only a numbered variant is taken', async () => {
    mockProjectNames('Copy (2) of Paratext 9 Interlinear');
    await renderModal();

    expect(screen.getByLabelText('Name')).toHaveValue('Copy of Paratext 9 Interlinear');
  });

  it('disables Create while the project list is loading', () => {
    mockSendCommand.mockReturnValue(new Promise(() => {}));
    render(
      <CopyToEditableModal
        sourceProjectId="src-proj"
        isSubmitting={false}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Create copy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('shows the Paratext 9 note on hovering the info icon', async () => {
    await renderModal();

    expect(screen.getByTestId('copy-to-editable-info')).toHaveAttribute(
      'title',
      'Later Paratext 9 changes stay out of the copy.',
    );
  });

  it('gives screen readers the Paratext 9 note in the dialog body', async () => {
    await renderModal();

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Later Paratext 9 changes stay out of the copy.',
    );
  });

  it('submits the edited name and trimmed description', async () => {
    const onSubmit = jest.fn();
    await renderModal({ onSubmit });

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), '  My copy  ');
    await userEvent.type(screen.getByLabelText('Description'), ' notes ');
    await userEvent.click(screen.getByRole('button', { name: 'Create copy' }));

    expect(onSubmit).toHaveBeenCalledWith('My copy', 'notes');
  });

  it('submits the default name and no description when both are blank', async () => {
    const onSubmit = jest.fn();
    await renderModal({ onSubmit });

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.click(screen.getByRole('button', { name: 'Create copy' }));

    expect(onSubmit).toHaveBeenCalledWith('Copy of Paratext 9 Interlinear', undefined);
  });

  it('submits the numbered default when the name is blank and the default is taken', async () => {
    mockProjectNames('Copy of Paratext 9 Interlinear');
    const onSubmit = jest.fn();
    await renderModal({ onSubmit });

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.click(screen.getByRole('button', { name: 'Create copy' }));

    expect(onSubmit).toHaveBeenCalledWith('Copy (2) of Paratext 9 Interlinear', undefined);
  });

  it('cancels without submitting', async () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    await renderModal({ onSubmit, onClose });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables both buttons while the copy is being created', async () => {
    await renderModal({ isSubmitting: true });

    expect(screen.getByRole('button', { name: 'Create copy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
