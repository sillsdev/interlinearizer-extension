/** @file Unit tests for components/InterlinearizerLoader.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import {
  useLocalizedStrings,
  useProjectData,
  useProjectSetting,
  useRecentScriptureRefs,
} from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { extractBookFromUsj } from 'parsers/papi/usjBookExtractor';
import InterlinearizerLoader from '../../components/InterlinearizerLoader';

jest.mock('parsers/papi/bookTokenizer');
jest.mock('parsers/papi/usjBookExtractor');

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: () => <div data-testid="continuous-view" />,
}));

/**
 * Matches the PlatformError shape from platform-bible-utils (discriminated by
 * platformErrorVersion).
 */
type PlatformError = { platformErrorVersion: number; message: string };

const defaultScrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };
const testProjectId = 'test-project-id';

/** Pre-built Book with one GEN 1:1 segment. */
const GEN_1_1_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [
    {
      id: 'GEN 1:1',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: 'In the beginning.',
      tokens: [
        {
          id: 'GEN 1:1:0',
          surfaceText: 'In',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 2,
        },
      ],
    },
  ],
};

/**
 * Returns a `useWebViewScrollGroupScrRef` hook stub bound to the given reference and setter.
 *
 * @param scrRef - Scripture reference to expose; defaults to GEN 1:1
 * @param setScrRef - Setter callback; defaults to a no-op
 */
function makeScrollGroupHook(
  scrRef: SerializedVerseRef = defaultScrRef,
  setScrRef: (r: SerializedVerseRef) => void = () => {},
) {
  return (): [
    SerializedVerseRef,
    (r: SerializedVerseRef) => void,
    number | undefined,
    (id: number | undefined) => void,
  ] => [scrRef, setScrRef, undefined, () => {}];
}

/** Configures useProjectData to return the given BookUSJ value and loading state this render. */
function mockBookData(value: unknown, isLoading = false): void {
  jest.mocked(useProjectData).mockImplementation(() => ({
    BookUSJ: () => [value, jest.fn(), isLoading],
  }));
}

/**
 * Configures useProjectSetting for the languageTag and continuousScroll keys. All other keys
 * receive their defaultState.
 *
 * @param tag - Writing system tag returned for `platform.languageTag`
 * @param continuousScroll - Value returned for `interlinearizer.continuousScroll`; defaults to
 *   `false` so existing token-chip rendering tests are unaffected
 */
function mockWritingSystem(tag: string | PlatformError = 'en', continuousScroll = false): void {
  jest.mocked(useProjectSetting).mockImplementation((_projectId, key, defaultState) => {
    if (key === 'platform.languageTag') return [tag, jest.fn(), jest.fn(), false];
    if (key === 'interlinearizer.continuousScroll')
      return [continuousScroll, jest.fn(), jest.fn(), false];
    return [defaultState, jest.fn(), jest.fn(), false];
  });
}

describe('InterlinearizerLoader', () => {
  beforeEach(() => {
    mockBookData(undefined);
    mockWritingSystem();
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, false]);
    jest.mocked(useRecentScriptureRefs).mockReturnValue({
      recentScriptureRefs: [],
      addRecentScriptureRef: jest.fn(),
    });
    jest.mocked(extractBookFromUsj).mockReturnValue({
      bookCode: 'GEN',
      writingSystem: 'en',
      contentHash: 'abc',
      verses: [],
    });
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_1_BOOK);
  });

  it('shows the book chapter control and renders a segment when book data is available', () => {
    mockBookData({});
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByTestId('book-chapter-control')).toBeInTheDocument();
    expect(screen.getByText('In')).toBeInTheDocument();
  });

  it('shows Loading when book data has not arrived', () => {
    mockBookData(undefined, true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error when no USJ book is available for the project', () => {
    mockBookData(undefined, false);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(screen.getByText(/no usj book available for gen in project/i)).toBeInTheDocument();
  });

  it('shows an error heading and message when book data is a PlatformError', () => {
    mockBookData({ platformErrorVersion: 1, message: 'Project not found' });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(screen.getByText(/project not found/i)).toBeInTheDocument();
  });

  it('falls back to "und" writing system when useProjectSetting returns a PlatformError', () => {
    mockBookData({});
    mockWritingSystem({ platformErrorVersion: 1, message: 'Setting unavailable' });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(extractBookFromUsj).toHaveBeenCalledWith(expect.anything(), 'und');
  });

  it('falls back to "und" writing system when useProjectSetting returns an empty string', () => {
    mockBookData({});
    mockWritingSystem('');
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(extractBookFromUsj).toHaveBeenCalledWith(expect.anything(), 'und');
  });

  it('shows an error heading and message when tokenization throws an Error', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockImplementation(() => {
      throw new Error('parse failure');
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(screen.getByText('parse failure')).toBeInTheDocument();
  });

  it('shows an error message when tokenization throws a non-Error value', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'unexpected string error';
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(screen.getByText('unexpected string error')).toBeInTheDocument();
  });

  it('passes a book-stable ref to BookUSJ so chapter and verse changes do not re-fetch the book', () => {
    const mockBookUSJ = jest.fn().mockReturnValue([{}, jest.fn(), false]);
    jest.mocked(useProjectData).mockImplementation(() => ({ BookUSJ: mockBookUSJ }));
    const { rerender } = render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );
    rerender(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook({
          book: 'GEN',
          chapterNum: 2,
          verseNum: 5,
        })}
      />,
    );

    const refsPassed = mockBookUSJ.mock.calls.map((c) => c[0]);
    refsPassed.forEach((ref) => expect(ref).toEqual({ book: 'GEN', chapterNum: 1, verseNum: 1 }));
    expect(mockBookUSJ.mock.calls.length).toBeGreaterThanOrEqual(2);
    refsPassed.slice(1).forEach((ref) => expect(ref).toBe(refsPassed[0]));
  });

  it('renders the continuous scroll toggle', () => {
    mockBookData({});
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('continuous scroll toggle is checked when the setting is true', () => {
    mockBookData({});
    mockWritingSystem('en', true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('continuous scroll toggle is unchecked when the setting is false', () => {
    mockBookData({});
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('clicking the continuous scroll toggle calls setContinuousScroll with the new value', async () => {
    mockBookData({});
    const mockSetContinuousScroll = jest.fn();
    jest.mocked(useProjectSetting).mockImplementation((_p, key, d) => {
      if (key === 'interlinearizer.continuousScroll')
        return [true, mockSetContinuousScroll, jest.fn(), false];
      if (key === 'platform.languageTag') return ['en', jest.fn(), jest.fn(), false];
      return [d, jest.fn(), jest.fn(), false];
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox'));

    expect(mockSetContinuousScroll).toHaveBeenCalledWith(false);
  });

  it('switches rendering immediately using optimistic local state while setting saves', async () => {
    mockBookData({});
    const mockSetContinuousScroll = jest.fn();
    // Setting source remains true during the test (simulates delayed persistence confirmation).
    jest.mocked(useProjectSetting).mockImplementation((_p, key, d) => {
      if (key === 'interlinearizer.continuousScroll')
        return [true, mockSetContinuousScroll, jest.fn(), false];
      if (key === 'platform.languageTag') return ['en', jest.fn(), jest.fn(), false];
      return [d, jest.fn(), jest.fn(), false];
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    // Initially in continuous mode.
    expect(screen.getByTestId('continuous-view')).toBeInTheDocument();
    expect(screen.queryByText('In')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox'));

    // Before setting saves, UI should already switch to token-chip mode.
    expect(screen.queryByTestId('continuous-view')).not.toBeInTheDocument();
    expect(screen.getByText('In')).toBeInTheDocument();
    expect(mockSetContinuousScroll).toHaveBeenCalledWith(false);
  });

  it('toggles continuous scroll setting back to true after being false', async () => {
    mockBookData({});
    const mockSetContinuousScroll = jest.fn();
    jest.mocked(useProjectSetting).mockImplementation((_p, key, d) => {
      if (key === 'interlinearizer.continuousScroll')
        return [false, mockSetContinuousScroll, jest.fn(), false];
      if (key === 'platform.languageTag') return ['en', jest.fn(), jest.fn(), false];
      return [d, jest.fn(), jest.fn(), false];
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      />,
    );

    // Initially in token-chip mode
    expect(screen.queryByTestId('continuous-view')).not.toBeInTheDocument();

    // Click toggle to turn on continuous mode
    await userEvent.click(screen.getByRole('checkbox'));
    expect(mockSetContinuousScroll).toHaveBeenCalledWith(true);
  });
});
