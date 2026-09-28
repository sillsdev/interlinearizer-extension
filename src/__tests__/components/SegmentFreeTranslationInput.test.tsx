/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import SegmentFreeTranslationInput from '../../components/SegmentFreeTranslationInput';
import type { StaleFreeTranslation } from '../../utils/stale-free-translations';

const mockDispatch = jest.fn();
const mockKeep = jest.fn();
const mockDiscard = jest.fn();
const mockReadOnlyState = { value: false };
const mockCommittedState = { value: '' };
const mockHasApprovedState = { value: false };

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  useSegmentFreeTranslation: () => mockCommittedState.value,
  useSegmentHasApprovedTranslation: () => mockHasApprovedState.value,
  useSegmentFreeTranslationDispatch: () => mockDispatch,
  useStaleFreeTranslationDispatch: () => ({ keep: mockKeep, discard: mockDiscard }),
  useReportGlossEditing: () => {},
  useAnalysisReadOnly: () => mockReadOnlyState.value,
}));

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_freeTranslationInput_placeholder%': 'Free translation',
  '%interlinearizer_freeTranslationInput_label%': 'Free translation',
  '%interlinearizer_freeTranslationInput_stale%': 'Stale',
  '%interlinearizer_freeTranslationInput_staleKeep%': 'Keep',
  '%interlinearizer_freeTranslationInput_staleDiscard%': 'Discard',
  '%interlinearizer_freeTranslationInput_staleNoText%': '(no translation)',
};

/** Builds a stale translation of GEN 1:1 reading `text`. */
function stale(analysisId: string, text = 'Au début'): StaleFreeTranslation {
  return { analysisId, segmentId: 'GEN 1:1', text };
}

describe('SegmentFreeTranslationInput', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
    mockCommittedState.value = '';
  });

  afterEach(() => {
    mockReadOnlyState.value = false;
    mockHasApprovedState.value = false;
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

  // A keyed remount stands in for the hydration swap, which unmounts this input and mounts a fresh
  // one because the segment around it changes component.
  it('refocuses the replacement input when a focused one is remounted', async () => {
    const { rerender } = render(
      <SegmentFreeTranslationInput key="a" segmentId="GEN 1:1" surfaceText="In the beginning" />,
    );
    await userEvent.click(screen.getByTestId('segment-free-translation-input'));

    rerender(
      <SegmentFreeTranslationInput key="b" segmentId="GEN 1:1" surfaceText="In the beginning" />,
    );

    expect(screen.getByTestId('segment-free-translation-input')).toHaveFocus();
  });

  // The await between unmount and remount is the point: it lets the arming frame lapse, as a
  // segment scrolled out of the mounted window and back does.
  it('leaves focus alone when the segment remounts after the arming frame', async () => {
    render(<button type="button">elsewhere</button>);
    const { unmount } = render(
      <SegmentFreeTranslationInput segmentId="GEN 1:3" surfaceText="In the beginning" />,
    );
    await userEvent.click(screen.getByTestId('segment-free-translation-input'));

    unmount();
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    render(<SegmentFreeTranslationInput segmentId="GEN 1:3" surfaceText="In the beginning" />);

    expect(screen.getByRole('button', { name: 'elsewhere' })).toHaveFocus();
    expect(screen.getByTestId('segment-free-translation-input')).not.toHaveFocus();
  });

  it('leaves focus alone when the remounted input was not focused', async () => {
    render(<button type="button">elsewhere</button>);
    const { rerender } = render(
      <SegmentFreeTranslationInput key="a" segmentId="GEN 1:2" surfaceText="In the beginning" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));

    rerender(
      <SegmentFreeTranslationInput key="b" segmentId="GEN 1:2" surfaceText="In the beginning" />,
    );

    expect(screen.getByTestId('segment-free-translation-input')).not.toHaveFocus();
  });

  describe('with a stale translation', () => {
    it('offers no review for a segment showing no stale translation', () => {
      render(<SegmentFreeTranslationInput segmentId="GEN 1:1" surfaceText="In the beginning" />);

      expect(screen.queryByTestId('stale-free-translations')).not.toBeInTheDocument();
    });

    it('starts the input from a lone stale translation standing in for an approved one', () => {
      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1')]}
          surfaceText="In the beginning"
        />,
      );

      const input = screen.getByTestId('segment-free-translation-input');
      expect(input).toHaveValue('Au début');
      expect(input).toHaveClass('tw:gloss-stale');
    });

    it('drops the stale marking from text the reader has edited', async () => {
      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1')]}
          surfaceText="In the beginning"
        />,
      );
      const input = screen.getByTestId('segment-free-translation-input');

      await userEvent.type(input, '!');

      expect(input).not.toHaveClass('tw:gloss-stale');
    });

    it('adopts the stale translation an edit was typed over', async () => {
      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1')]}
          surfaceText="In the beginning"
        />,
      );

      await userEvent.type(screen.getByTestId('segment-free-translation-input'), '!');
      await userEvent.tab();

      expect(mockDispatch).toHaveBeenCalledWith('GEN 1:1', 'In the beginning', 'Au début!', 'sa-1');
    });

    it('commits nothing when the stale text is left as it was', async () => {
      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1')]}
          surfaceText="In the beginning"
        />,
      );

      await userEvent.click(screen.getByTestId('segment-free-translation-input'));
      await userEvent.tab();

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('keeps a stale translation for the text the segment now reads', async () => {
      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1')]}
          surfaceText="In the beginning"
        />,
      );

      await userEvent.click(screen.getByTestId('stale-free-translation-keep'));

      expect(mockKeep).toHaveBeenCalledWith('sa-1', 'GEN 1:1', 'In the beginning');
    });

    it('discards a stale translation', async () => {
      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1')]}
          surfaceText="In the beginning"
        />,
      );

      await userEvent.click(screen.getByTestId('stale-free-translation-discard'));

      expect(mockDiscard).toHaveBeenCalledWith('sa-1');
    });

    it('discards an edited stale translation without approving the edit', async () => {
      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1')]}
          surfaceText="In the beginning"
        />,
      );

      await userEvent.type(screen.getByTestId('segment-free-translation-input'), '!');
      await userEvent.click(screen.getByTestId('stale-free-translation-discard'));

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockDiscard).toHaveBeenCalledWith('sa-1');
    });

    it('commits a translation typed beside listed stale translations before discarding one', async () => {
      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1', 'Au début'), stale('sa-2', 'Dieu créa')]}
          surfaceText="In the beginning"
        />,
      );

      await userEvent.type(screen.getByTestId('segment-free-translation-input'), 'Au commencement');
      await userEvent.click(screen.getAllByTestId('stale-free-translation-discard')[0]);

      expect(mockDispatch).toHaveBeenCalledWith('GEN 1:1', 'In the beginning', 'Au commencement');
      expect(mockDiscard).toHaveBeenCalledWith('sa-1');
    });

    it('lists each of several stale translations, starting the input empty', () => {
      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1', 'Au début'), stale('sa-2', 'Dieu créa')]}
          surfaceText="In the beginning"
        />,
      );

      expect(screen.getAllByTestId('stale-free-translation').map((row) => row.textContent)).toEqual(
        ['Au débutKeepDiscard', 'Dieu créaKeepDiscard'],
      );
      expect(screen.getByTestId('segment-free-translation-input')).toHaveValue('');
    });

    // Nothing in the active language to start from, so it is listed rather than filled in.
    it('lists a lone stale translation holding nothing in the active language', () => {
      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1', '')]}
          surfaceText="In the beginning"
        />,
      );

      expect(screen.getByTestId('stale-free-translation')).toHaveTextContent('(no translation)');
      expect(screen.getByTestId('segment-free-translation-input')).toHaveValue('');
    });

    it('offers only discarding while the segment holds an approved translation', () => {
      mockHasApprovedState.value = true;
      mockCommittedState.value = 'Au commencement';

      render(
        <SegmentFreeTranslationInput
          segmentId="GEN 1:1"
          stale={[stale('sa-1')]}
          surfaceText="In the beginning"
        />,
      );

      expect(screen.getByTestId('segment-free-translation-input')).toHaveValue('Au commencement');
      expect(screen.queryByTestId('stale-free-translation-keep')).not.toBeInTheDocument();
      expect(screen.getByTestId('stale-free-translation-discard')).toBeInTheDocument();
    });
  });
});
