/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { CopyToEditableModal } from '../../../components/modals/CopyToEditableModal';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_copyModal_title%': 'Copy to editable project',
  '%interlinearizer_copyModal_defaultName%': 'Copy of Paratext 9 Interlinear',
  '%interlinearizer_copyModal_create%': 'Create copy',
  '%interlinearizer_copyModal_cancel%': 'Cancel',
  '%interlinearizer_modal_metadata_name_label%': 'Name',
  '%interlinearizer_modal_metadata_description_label%': 'Description',
};

describe('CopyToEditableModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('prefills the name with the localized default', () => {
    render(<CopyToEditableModal isSubmitting={false} onSubmit={jest.fn()} onClose={jest.fn()} />);

    expect(screen.getByLabelText('Name')).toHaveValue('Copy of Paratext 9 Interlinear');
  });

  it('submits the edited name and trimmed description', async () => {
    const onSubmit = jest.fn();
    render(<CopyToEditableModal isSubmitting={false} onSubmit={onSubmit} onClose={jest.fn()} />);

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), '  My copy  ');
    await userEvent.type(screen.getByLabelText('Description'), ' notes ');
    await userEvent.click(screen.getByRole('button', { name: 'Create copy' }));

    expect(onSubmit).toHaveBeenCalledWith('My copy', 'notes');
  });

  it('submits the default name and no description when both are blank', async () => {
    const onSubmit = jest.fn();
    render(<CopyToEditableModal isSubmitting={false} onSubmit={onSubmit} onClose={jest.fn()} />);

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.click(screen.getByRole('button', { name: 'Create copy' }));

    expect(onSubmit).toHaveBeenCalledWith('Copy of Paratext 9 Interlinear', undefined);
  });

  it('cancels without submitting', async () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    render(<CopyToEditableModal isSubmitting={false} onSubmit={onSubmit} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables both buttons while the copy is being created', () => {
    render(<CopyToEditableModal isSubmitting onSubmit={jest.fn()} onClose={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Create copy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
