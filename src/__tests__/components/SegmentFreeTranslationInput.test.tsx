/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import SegmentFreeTranslationInput from '../../components/SegmentFreeTranslationInput';

const mockDispatch = jest.fn();
const mockReadOnlyState = { value: false };
const mockCommittedState = { value: '' };

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  useSegmentFreeTranslation: () => mockCommittedState.value,
  useSegmentFreeTranslationDispatch: () => mockDispatch,
  useReportGlossEditing: () => {},
  useAnalysisReadOnly: () => mockReadOnlyState.value,
}));

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_freeTranslationInput_placeholder%': 'Free translation',
  '%interlinearizer_freeTranslationInput_label%': 'Free translation',
};

describe('SegmentFreeTranslationInput', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
    mockCommittedState.value = '';
  });

  afterEach(() => {
    mockReadOnlyState.value = false;
  });

  it('commits the typed translation on blur', async () => {
    render(<SegmentFreeTranslationInput segmentId="GEN 1:1" surfaceText="In the beginning" />);

    const input = screen.getByTestId('segment-free-translation-input');
    await userEvent.type(input, 'Au commencement');
    await userEvent.tab();

    expect(mockDispatch).toHaveBeenCalledWith('GEN 1:1', 'In the beginning', 'Au commencement');
  });

  it('renders the stored translation as plain text when read-only', () => {
    mockReadOnlyState.value = true;
    mockCommittedState.value = 'Au commencement';

    render(<SegmentFreeTranslationInput segmentId="GEN 1:1" surfaceText="In the beginning" />);

    expect(screen.getByTestId('readonly-free-translation')).toHaveTextContent('Au commencement');
    expect(screen.queryByTestId('segment-free-translation-input')).not.toBeInTheDocument();
  });

  it('renders nothing when read-only with no stored translation', () => {
    mockReadOnlyState.value = true;

    const { container } = render(
      <SegmentFreeTranslationInput segmentId="GEN 1:1" surfaceText="In the beginning" />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
