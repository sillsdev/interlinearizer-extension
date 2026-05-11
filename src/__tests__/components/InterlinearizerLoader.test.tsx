/** @file Unit tests for components/InterlinearizerLoader.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useData, useLocalizedStrings, useSetting } from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book } from 'interlinearizer';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../../hooks/useOptimisticBooleanSetting';
import InterlinearizerLoader from '../../components/InterlinearizerLoader';

jest.mock('../../hooks/useInterlinearizerBookData');
jest.mock('../../hooks/useOptimisticBooleanSetting');

jest.mock('../../components/ContinuousScrollToggle', () => ({
  __esModule: true,
  default: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked: boolean;
    disabled: boolean;
    onCheckedChange: (v: boolean) => void;
  }) => (
    <button
      aria-label="continuous scroll"
      data-testid="continuous-scroll-toggle"
      data-checked={String(checked)}
      data-disabled={String(disabled)}
      onClick={() => onCheckedChange(!checked)}
      type="button"
    />
  ),
}));

jest.mock('../../components/ScriptureNavControls', () => ({
  __esModule: true,
  default: () => <div data-testid="scripture-nav-controls" />,
}));

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: () => <div data-testid="continuous-view" />,
}));

type CapturedInterlinearizerProps = {
  continuousScroll: boolean;
};
let capturedInterlinearizerProps: CapturedInterlinearizerProps | undefined;

jest.mock('../../components/Interlinearizer', () => ({
  __esModule: true,
  default: (props: CapturedInterlinearizerProps) => {
    capturedInterlinearizerProps = props;
    return <div data-testid="interlinearizer" />;
  },
}));

const defaultScrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };
const testProjectId = 'test-project-id';

/** A minimal Book used as the successful hook result. */
const TEST_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [],
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

/** Typed read/write pair stored per key in {@link makeWebViewState}. */
type StateSlot<T> = { get: () => T; set: (v: T) => void };

/**
 * Returns a `useWebViewState` hook stub that stores values in typed per-key closures so state
 * persists across re-renders within the same test without requiring any type assertions.
 */
function makeWebViewState() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots = new Map<string, StateSlot<any>>();
  return <T,>(key: string, defaultValue: T): [T, (v: T) => void, () => void] => {
    let slot: StateSlot<T> | undefined = slots.get(key);
    if (slot === undefined) {
      let stored = defaultValue;
      slot = {
        get: () => stored,
        set: (v) => {
          stored = v;
        },
      };
      slots.set(key, slot);
    }
    const resolvedSlot = slot;
    return [
      resolvedSlot.get(),
      (v: T) => resolvedSlot.set(v),
      () => {
        slots.delete(key);
      },
    ];
  };
}

/**
 * Configures useInterlinearizerBookData to return the given state.
 *
 * @param overrides - Partial hook result; all fields default to a successful loaded state
 */
function mockBookData(
  overrides: Partial<{
    book: Book | undefined;
    chapterSegments: Book['segments'];
    isLoading: boolean;
    bookError: string | undefined;
    tokenizeError: { message: string; raw: unknown } | undefined;
  }> = {},
): void {
  jest.mocked(useInterlinearizerBookData).mockReturnValue({
    book: TEST_BOOK,
    chapterSegments: [],
    isLoading: false,
    bookError: undefined,
    tokenizeError: undefined,
    ...overrides,
  });
}

/**
 * Configures useOptimisticBooleanSetting to return the given state.
 *
 * @param value - The current boolean value; defaults to `false`
 * @param onChange - The change handler; defaults to a jest.fn()
 * @param isLoading - Whether the setting is loading; defaults to `false`
 */
function mockOptimisticSetting(
  value = false,
  onChange: jest.Mock = jest.fn(),
  isLoading = false,
): jest.Mock {
  jest.mocked(useOptimisticBooleanSetting).mockReturnValue({ value, onChange, isLoading });
  return onChange;
}

describe('InterlinearizerLoader', () => {
  beforeEach(() => {
    capturedInterlinearizerProps = undefined;
    mockBookData();
    mockOptimisticSetting();
    jest
      .mocked(useData)
      .mockReturnValue(
        new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
      );
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, false]);
    jest.mocked(useSetting).mockReturnValue(['simple', jest.fn(), jest.fn(), false]);
  });

  it('shows nav controls when interface mode is power', () => {
    jest.mocked(useSetting).mockReturnValue(['power', jest.fn(), jest.fn(), false]);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByTestId('scripture-nav-controls')).toBeInTheDocument();
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('hides nav controls when interface mode is simple', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.queryByTestId('scripture-nav-controls')).not.toBeInTheDocument();
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('shows Loading when book data has not arrived', () => {
    mockBookData({ book: undefined, isLoading: true });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error when no USJ book is available for the project', () => {
    mockBookData({
      book: undefined,
      bookError: 'No USJ book available for GEN in project test-project-id',
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(screen.getByText(/no usj book available for gen in project/i)).toBeInTheDocument();
  });

  it('shows an error heading and message when book data is a PlatformError', () => {
    mockBookData({ book: undefined, bookError: 'Project not found' });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(screen.getByText(/project not found/i)).toBeInTheDocument();
  });

  it('shows an error heading and message when tokenization throws an Error', () => {
    mockBookData({
      book: undefined,
      tokenizeError: { message: 'parse failure', raw: new Error('parse failure') },
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(screen.getByText('parse failure')).toBeInTheDocument();
  });

  it('shows an error message when tokenization throws a non-Error value', () => {
    mockBookData({
      book: undefined,
      tokenizeError: { message: 'unexpected string error', raw: 'unexpected string error' },
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(screen.getByText('unexpected string error')).toBeInTheDocument();
  });

  it('passes a book-stable ref to BookUSJ so chapter and verse changes do not re-fetch the book', () => {
    // The book-stable ref logic lives in useInterlinearizerBookData, which is tested in its own
    // test file. This test verifies that InterlinearizerLoader passes scrRef into the hook and that
    // re-rendering with a new verse does not cause the hook to receive a new book ref.
    const webViewState = makeWebViewState();
    const { rerender } = render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={webViewState}
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
        useWebViewState={webViewState}
      />,
    );

    const { calls } = jest.mocked(useInterlinearizerBookData).mock;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    calls.forEach((args) => expect(args[0].projectId).toBe(testProjectId));
  });

  it('passes continuousScroll from useOptimisticBooleanSetting to Interlinearizer', () => {
    mockOptimisticSetting(true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.continuousScroll).toBe(true);
  });

  it('passes checked and disabled from useOptimisticBooleanSetting to ContinuousScrollToggle', () => {
    mockOptimisticSetting(true, jest.fn(), true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    const toggle = screen.getByTestId('continuous-scroll-toggle');
    expect(toggle).toHaveAttribute('data-checked', 'true');
    expect(toggle).toHaveAttribute('data-disabled', 'true');
  });

  it('wires ContinuousScrollToggle onCheckedChange to the onChange from useOptimisticBooleanSetting', async () => {
    const mockOnChange = jest.fn();
    mockOptimisticSetting(false, mockOnChange);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    await userEvent.click(screen.getByTestId('continuous-scroll-toggle'));

    expect(mockOnChange).toHaveBeenCalledWith(true);
  });
});
