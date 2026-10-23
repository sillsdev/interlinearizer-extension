/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pt9ReadOnlyIntroModal } from '../../../components/modals/Pt9ReadOnlyIntroModal';
import { mockKeyAsValueLocalizedStrings } from '../test-helpers';

describe('Pt9ReadOnlyIntroModal', () => {
  beforeEach(() => {
    mockKeyAsValueLocalizedStrings();
  });

  it('explains where the interlinear came from and how to make it editable', () => {
    render(<Pt9ReadOnlyIntroModal onCopy={jest.fn()} onViewReadOnly={jest.fn()} />);

    expect(screen.getByTestId('pt9-read-only-intro-title')).toHaveTextContent(
      '%interlinearizer_pt9ReadOnlyIntro_title%',
    );
    expect(screen.getByTestId('pt9-read-only-intro-origin')).toHaveTextContent(
      '%interlinearizer_pt9ReadOnlyIntro_origin%',
    );
    expect(screen.getByTestId('pt9-read-only-intro-how-to-edit')).toHaveTextContent(
      '%interlinearizer_pt9ReadOnlyIntro_howToEdit%',
    );
  });

  it('copies on Copy to editable', async () => {
    const onCopy = jest.fn();
    const onViewReadOnly = jest.fn();
    render(<Pt9ReadOnlyIntroModal onCopy={onCopy} onViewReadOnly={onViewReadOnly} />);

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_pt9ReadOnlyIntro_copy%' }),
    );

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onViewReadOnly).not.toHaveBeenCalled();
  });

  it('views read-only on View read-only', async () => {
    const onCopy = jest.fn();
    const onViewReadOnly = jest.fn();
    render(<Pt9ReadOnlyIntroModal onCopy={onCopy} onViewReadOnly={onViewReadOnly} />);

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_pt9ReadOnlyIntro_view%' }),
    );

    expect(onViewReadOnly).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it('views read-only when dismissed', async () => {
    const onCopy = jest.fn();
    const onViewReadOnly = jest.fn();
    render(<Pt9ReadOnlyIntroModal onCopy={onCopy} onViewReadOnly={onViewReadOnly} />);

    await userEvent.keyboard('{Escape}');

    expect(onViewReadOnly).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();
  });
});
