/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { logger } from '@papi/frontend';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { Book, Segment, Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import {
  createFocusStore,
  FocusProvider,
  FocusStoreProvider,
  useFocus,
  useFocusActions,
  useFocusGetter,
  type Focus,
  type FocusActions,
} from '../../components/FocusStore';
import { InterlinearNavProvider, useInterlinearNav } from '../../components/InterlinearNavContext';
import { isWordToken } from '../../types/type-guards';
import { makeSegment, makeWordToken, type ScrollGroupTuple } from '../test-helpers';

/**
 * A two-verse GEN book whose first verse holds two word tokens, so a focus can sit on a non-first
 * token of the segment that owns the active verse.
 */
function makeBook(): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: '1',
    segments: [
      makeSegment('GEN 1:1', 'In beginning', [
        makeWordToken('GEN 1:1:0', 'In'),
        makeWordToken('GEN 1:1:1', 'beginning', 3),
      ]),
      makeSegment('GEN 1:2', 'And', [makeWordToken('GEN 1:2:0', 'And')]),
    ],
  };
}

/** The lookups {@link FocusProvider} resolves a focus against, derived from `book`. */
function buildLookups(book: Book) {
  const segmentById = new Map<string, Segment>();
  const tokenSegmentMap = new Map<string, string>();
  const wordTokenByRef = new Map<string, Token & { type: 'word' }>();
  book.segments.forEach((seg) => {
    segmentById.set(seg.id, seg);
    seg.tokens.forEach((t) => {
      tokenSegmentMap.set(t.ref, seg.id);
      if (isWordToken(t)) wordTokenByRef.set(t.ref, t);
    });
  });
  return { segmentById, tokenSegmentMap, wordTokenByRef };
}

/**
 * Mounts a {@link FocusProvider} over a scroll-group stub whose reference the test controls, and
 * exposes the focus and navigation surfaces plus a `setBook` / `setScrRef` pair for restaging the
 * inputs the resolution rules classify on. A fresh reference object is required on each change so
 * the nav provider adopts it.
 */
function renderFocus(initialBook: Book, initialScrRef: SerializedVerseRef) {
  let book = initialBook;
  let hostScrRef = initialScrRef;
  const setScrRefSpy = jest.fn((next: SerializedVerseRef) => {
    hostScrRef = next;
  });
  const scrollGroupHook = (): ScrollGroupTuple => [
    hostScrRef,
    setScrRefSpy,
    undefined,
    () => {},
    undefined,
  ];

  let focus: Focus | undefined;
  let actions: FocusActions | undefined;
  let nav: ReturnType<typeof useInterlinearNav> | undefined;

  function Probe() {
    focus = useFocus();
    actions = useFocusActions();
    return <div data-testid="probe" data-focus={focus.tokenRef ?? ''} />;
  }

  function Tree() {
    nav = useInterlinearNav();
    return (
      <FocusProvider book={book} scrRef={hostScrRef} {...buildLookups(book)}>
        <Probe />
      </FocusProvider>
    );
  }

  const view = render(
    <InterlinearNavProvider useWebViewScrollGroupScrRef={scrollGroupHook}>
      <Tree />
    </InterlinearNavProvider>,
  );

  return {
    /** The focus, its origin, and the surfaces a test drives it through. */
    read: () => {
      if (!focus || !actions || !nav) throw new Error('The focus harness has not rendered');
      return { ...focus, actions, nav };
    },
    setScrRefSpy,
    setBook: (next: Book) => {
      book = next;
      view.rerender(
        <InterlinearNavProvider useWebViewScrollGroupScrRef={scrollGroupHook}>
          <Tree />
        </InterlinearNavProvider>,
      );
    },
    setScrRef: (next: SerializedVerseRef) => {
      hostScrRef = next;
      view.rerender(
        <InterlinearNavProvider useWebViewScrollGroupScrRef={scrollGroupHook}>
          <Tree />
        </InterlinearNavProvider>,
      );
    },
  };
}

const GEN_1_1: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };
const GEN_1_2: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 2 };

beforeEach(() => {
  jest.mocked(logger.warn).mockClear();
});

describe('createFocusStore', () => {
  it('seeds the focus it is given as a seed origin', () => {
    expect(createFocusStore('GEN 1:1:1').getFocus()).toEqual({
      tokenRef: 'GEN 1:1:1',
      origin: 'seed',
    });
  });

  it('applies a write and notifies every subscriber', () => {
    const store = createFocusStore(undefined);
    const first = jest.fn();
    const second = jest.fn();
    store.subscribe(first);
    store.subscribe(second);

    store.write('GEN 1:2:0', 'list');

    expect(store.getFocus()).toEqual({ tokenRef: 'GEN 1:2:0', origin: 'list' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('drops a write naming the token already focused, so a reseed onto it wakes nobody', () => {
    const store = createFocusStore('GEN 1:1:1');
    const listener = jest.fn();
    store.subscribe(listener);

    store.write('GEN 1:1:1', 'reseed');

    expect(store.getFocus().origin).toBe('seed');
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying once unsubscribed', () => {
    const store = createFocusStore(undefined);
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.write('GEN 1:1:0', 'strip');

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('focus hooks', () => {
  /** Wraps children in a provider over `store`, with inert actions. */
  function withStore(store = createFocusStore('GEN 1:1:0')) {
    const actions: FocusActions = { focusToken: () => {}, selectSegment: () => {} };
    return {
      store,
      wrapper: ({ children }: { children: ReactNode }) => (
        <FocusStoreProvider store={store} actions={actions}>
          {children}
        </FocusStoreProvider>
      ),
    };
  }

  it('re-renders a subscriber on a focus move', () => {
    const { store, wrapper } = withStore();
    const renders = jest.fn();
    const { result } = renderHook(
      () => {
        renders();
        return useFocus();
      },
      { wrapper },
    );

    act(() => store.write('GEN 1:2:0', 'list'));

    expect(result.current).toEqual({ tokenRef: 'GEN 1:2:0', origin: 'list' });
    expect(renders).toHaveBeenCalledTimes(2);
  });

  it('leaves a getter-only reader unrendered by a focus move', () => {
    const { store, wrapper } = withStore();
    const renders = jest.fn();
    const { result } = renderHook(
      () => {
        renders();
        return useFocusGetter();
      },
      { wrapper },
    );

    act(() => store.write('GEN 1:2:0', 'list'));

    expect(result.current().tokenRef).toBe('GEN 1:2:0');
    expect(renders).toHaveBeenCalledTimes(1);
  });

  it('hands back the provider actions', () => {
    const { wrapper } = withStore();
    const { result } = renderHook(() => useFocusActions(), { wrapper });

    expect(result.current.focusToken).toBeInstanceOf(Function);
    expect(result.current.selectSegment).toBeInstanceOf(Function);
  });

  it.each([
    ['useFocus', useFocus],
    ['useFocusGetter', useFocusGetter],
    ['useFocusActions', useFocusActions],
  ])('%s throws outside a provider', (name, hook) => {
    expect(() => renderHook(() => hook())).toThrow(`${name} must be used within a FocusProvider`);
  });
});

describe('FocusProvider seeding', () => {
  it('seeds the first word token of the segment that owns the active verse', () => {
    const harness = renderFocus(makeBook(), GEN_1_2);

    expect(harness.read().tokenRef).toBe('GEN 1:2:0');
    expect(harness.read().origin).toBe('seed');
  });

  it('seeds nothing when no segment owns the active verse', () => {
    const harness = renderFocus(makeBook(), { book: 'GEN', chapterNum: 9, verseNum: 9 });

    expect(harness.read().tokenRef).toBeUndefined();
    expect(screen.getByTestId('probe')).toHaveAttribute('data-focus', '');
  });

  it('seeds nothing when the active segment has no word token', () => {
    const punctuationOnly: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: '1',
      segments: [makeSegment('GEN 1:1', '', [])],
    };

    expect(renderFocus(punctuationOnly, GEN_1_1).read().tokenRef).toBeUndefined();
  });
});

describe('FocusProvider focusToken', () => {
  it('navigates to the target segment when it does not hold the active verse', () => {
    const harness = renderFocus(makeBook(), GEN_1_1);

    act(() => harness.read().actions.focusToken('GEN 1:2:0', 'strip'));

    expect(harness.read()).toMatchObject({ tokenRef: 'GEN 1:2:0', origin: 'strip' });
    expect(harness.setScrRefSpy).toHaveBeenCalledWith(GEN_1_2);
  });

  it('focuses without navigating within the segment that already holds the active verse', () => {
    const harness = renderFocus(makeBook(), GEN_1_1);

    act(() => harness.read().actions.focusToken('GEN 1:1:1', 'strip'));

    expect(harness.read().tokenRef).toBe('GEN 1:1:1');
    expect(harness.setScrRefSpy).not.toHaveBeenCalled();
  });

  it('does not echo a verse from a book the reference has already left', () => {
    // Mid cross-book navigation the reference names the new book while the mounted book — and so
    // this token — still belong to the previous one; echoing that verse would overwrite the target.
    const harness = renderFocus(makeBook(), { book: 'MAT', chapterNum: 1, verseNum: 1 });

    act(() => harness.read().actions.focusToken('GEN 1:2:0', 'strip'));

    expect(harness.read().tokenRef).toBe('GEN 1:2:0');
    expect(harness.setScrRefSpy).not.toHaveBeenCalled();
  });
});

describe('FocusProvider selectSegment', () => {
  it('navigates and focuses the clicked token', () => {
    const harness = renderFocus(makeBook(), GEN_1_1);

    act(() =>
      harness.read().actions.selectSegment({ book: 'GEN', chapter: 1, verse: 2 }, 'GEN 1:2:0'),
    );

    expect(harness.read()).toMatchObject({ tokenRef: 'GEN 1:2:0', origin: 'list' });
    expect(harness.setScrRefSpy).toHaveBeenCalledWith(GEN_1_2);
  });

  it('skips the navigation when the selected verse is already active', () => {
    const harness = renderFocus(makeBook(), GEN_1_1);

    act(() =>
      harness.read().actions.selectSegment({ book: 'GEN', chapter: 1, verse: 1 }, 'GEN 1:1:1'),
    );

    expect(harness.read().tokenRef).toBe('GEN 1:1:1');
    expect(harness.setScrRefSpy).not.toHaveBeenCalled();
  });

  it('leaves the focus alone when the whole segment was selected', () => {
    const harness = renderFocus(makeBook(), GEN_1_1);

    act(() => harness.read().actions.selectSegment({ book: 'GEN', chapter: 1, verse: 2 }));

    expect(harness.read().tokenRef).toBe('GEN 1:1:0');
    expect(harness.setScrRefSpy).toHaveBeenCalledWith(GEN_1_2);
  });
});

describe('FocusProvider resolution rules', () => {
  it('keeps a focus the re-segmented book still resolves', () => {
    const harness = renderFocus(makeBook(), GEN_1_1);
    act(() => harness.read().actions.focusToken('GEN 1:1:1', 'strip'));

    // A boundary edit produces a fresh book carrying the same token refs.
    const merged: Book = { ...makeBook(), segments: [...makeBook().segments] };
    harness.setBook(merged);

    expect(harness.read().tokenRef).toBe('GEN 1:1:1');
  });

  it('reseeds to the active verse when the new book cannot resolve the focus', () => {
    const harness = renderFocus(makeBook(), GEN_1_1);
    act(() => harness.read().actions.focusToken('GEN 1:1:1', 'strip'));

    const retokenized: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: '2',
      segments: [makeSegment('GEN 1:1', 'Anew', [makeWordToken('GEN 1:1:9', 'Anew')])],
    };
    harness.setBook(retokenized);

    expect(harness.read()).toMatchObject({ tokenRef: 'GEN 1:1:9', origin: 'reseed' });
  });

  it('keeps the focus when its own segment contains the new verse', () => {
    const spanning: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: '1',
      segments: [
        {
          ...makeSegment('GEN 1:1', 'In beginning', [
            makeWordToken('GEN 1:1:0', 'In'),
            makeWordToken('GEN 1:1:1', 'beginning', 3),
          ]),
          verseStarts: [
            { charStart: 0, number: '1', chapter: 1 },
            { charStart: 3, number: '2', chapter: 1 },
          ],
        },
      ],
    };
    const harness = renderFocus(spanning, GEN_1_1);
    act(() => harness.read().actions.focusToken('GEN 1:1:1', 'strip'));

    harness.setScrRef(GEN_1_2);

    expect(harness.read().tokenRef).toBe('GEN 1:1:1');
  });

  it('reseeds to the new verse when nothing is focused yet', () => {
    // The active verse resolves no word token, so the seed leaves focus unset and the verse change
    // has no focused segment to test against.
    const noWordToken: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: '1',
      segments: [makeSegment('GEN 1:1', '', []), ...makeBook().segments.slice(1)],
    };
    const harness = renderFocus(noWordToken, GEN_1_1);
    expect(harness.read().tokenRef).toBeUndefined();

    harness.setScrRef(GEN_1_2);

    expect(harness.read()).toMatchObject({ tokenRef: 'GEN 1:2:0', origin: 'reseed' });
  });

  it('reseeds to the new verse when the focused segment does not contain it', () => {
    const harness = renderFocus(makeBook(), GEN_1_1);

    harness.setScrRef(GEN_1_2);

    expect(harness.read()).toMatchObject({ tokenRef: 'GEN 1:2:0', origin: 'reseed' });
  });

  it('claims a focus request over the verse reseed landing in the same commit', () => {
    // A request moves focus and nothing else, so its caller navigates too; both land in one commit,
    // which is exactly where the two rules would otherwise race.
    const harness = renderFocus(makeBook(), GEN_1_1);

    act(() => {
      harness.read().nav.requestFocusToken('GEN 1:1:1');
      harness.read().nav.navigate(GEN_1_2, 'internal');
    });

    // The verse change alone would have reseeded to the new verse's first word.
    expect(harness.read()).toMatchObject({ tokenRef: 'GEN 1:1:1', origin: 'request' });
  });

  it('warns and falls through to the reseed when the book cannot resolve the request', () => {
    const harness = renderFocus(makeBook(), GEN_1_1);

    act(() => {
      harness.read().nav.requestFocusToken('GEN 1:1:99');
      harness.read().nav.navigate(GEN_1_2, 'internal');
    });

    expect(jest.mocked(logger.warn)).toHaveBeenCalledWith(
      'Interlinearizer: focus request "GEN 1:1:99" matched no word token',
    );
    expect(harness.read()).toMatchObject({ tokenRef: 'GEN 1:2:0', origin: 'reseed' });
  });

  it('claims a request naming the verse already on screen', () => {
    // The request count is the only signal such a request gives, since nothing else about
    // navigation changes.
    const harness = renderFocus(makeBook(), GEN_1_1);

    act(() => harness.read().nav.requestFocusToken('GEN 1:1:1'));

    expect(harness.read()).toMatchObject({ tokenRef: 'GEN 1:1:1', origin: 'request' });
  });

  it('leaves a request naming another book pending', () => {
    const harness = renderFocus(makeBook(), GEN_1_1);

    act(() => harness.read().nav.requestFocusToken('MAT 1:1:0'));

    expect(harness.read().tokenRef).toBe('GEN 1:1:0');
    expect(jest.mocked(logger.warn)).not.toHaveBeenCalled();
  });
});
