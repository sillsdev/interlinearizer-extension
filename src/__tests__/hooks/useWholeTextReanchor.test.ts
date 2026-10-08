/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import type { Book, DraftProject } from 'interlinearizer';
import useWholeTextReanchor, {
  type UseWholeTextReanchorArgs,
} from '../../hooks/useWholeTextReanchor';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { reanchorDraftToBook, reanchorDraftToMissingBook } from '../../utils/reanchor-draft';
import { FIXTURE_STAMPS } from '../test-helpers';

// What a pass does to the draft is the re-anchoring core's concern; these tests check only which
// pass each book is handed.
jest.mock('../../utils/reanchor-draft');

const toBookPass = jest.fn();
const toMissingBookPass = jest.fn();

/** A draft approving a word at each of `tokenRefs`. */
function draftLinkingInto(...tokenRefs: string[]): DraftProject {
  return {
    ...emptyDraft('src'),
    analysis: {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'beta' }],
      tokenAnalysisLinks: tokenRefs.map((tokenRef) => ({
        ...FIXTURE_STAMPS,
        analysisId: 'ta-1',
        status: 'approved',
        token: { tokenRef, surfaceText: 'beta' },
      })),
    },
  };
}

/** A stand-in reading of a book, which the hook reads only the code of. */
function book(bookRef: string): Book {
  return { id: bookRef, bookRef, textVersion: 'v1', segments: [], duplicateVerseIds: [] };
}

let reanchorBook: jest.Mock;

/** Arguments for a loaded draft approving a word in Exodus, with Genesis loaded. */
function makeArgs(overrides: Partial<UseWholeTextReanchorArgs> = {}): UseWholeTextReanchorArgs {
  return {
    loadedBookCode: 'GEN',
    isImportView: false,
    isDraftLoading: false,
    draftVersion: 1,
    getDraftSnapshot: () => draftLinkingInto('EXO 1:1:3'),
    reanchorBook,
    ...overrides,
  };
}

beforeEach(() => {
  reanchorBook = jest.fn();
  jest.mocked(reanchorDraftToBook).mockReturnValue(toBookPass);
  jest.mocked(reanchorDraftToMissingBook).mockReturnValue(toMissingBookPass);
});

describe('useWholeTextReanchor', () => {
  describe('readKey', () => {
    it('is the draft version once the draft has loaded', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs({ draftVersion: 3 })));

      expect(result.current.readKey).toBe(3);
    });

    it('is undefined while the draft loads', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs({ isDraftLoading: true })));

      expect(result.current.readKey).toBeUndefined();
    });

    it('is undefined while an import is shown', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs({ isImportView: true })));

      expect(result.current.readKey).toBeUndefined();
    });
  });

  describe('onBookRead', () => {
    it('re-anchors the draft to a book it links into', () => {
      const exodus = book('EXO');
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs()));

      act(() => result.current.onBookRead(exodus));

      expect(reanchorDraftToBook).toHaveBeenCalledWith(exodus);
      expect(reanchorBook).toHaveBeenCalledWith('EXO', toBookPass);
    });

    it('leaves the loaded book to its live text', () => {
      const { result } = renderHook(() =>
        useWholeTextReanchor(makeArgs({ loadedBookCode: 'EXO' })),
      );

      act(() => result.current.onBookRead(book('EXO')));

      expect(reanchorBook).not.toHaveBeenCalled();
    });

    it('leaves a book the draft has no links in', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs()));

      act(() => result.current.onBookRead(book('LEV')));

      expect(reanchorBook).not.toHaveBeenCalled();
    });

    it('leaves the draft alone while an import is shown', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs({ isImportView: true })));

      act(() => result.current.onBookRead(book('EXO')));

      expect(reanchorBook).not.toHaveBeenCalled();
    });
  });

  describe('onTextRead', () => {
    it('stales the approvals in a book the text lacks', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs()));

      act(() => result.current.onTextRead(['GEN']));

      expect(reanchorDraftToMissingBook).toHaveBeenCalledWith('EXO');
      expect(reanchorBook).toHaveBeenCalledWith('EXO', toMissingBookPass);
    });

    it('leaves a book the text holds', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs()));

      act(() => result.current.onTextRead(['GEN', 'EXO']));

      expect(reanchorBook).not.toHaveBeenCalled();
    });

    it('leaves the draft alone while an import is shown', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs({ isImportView: true })));

      act(() => result.current.onTextRead(['GEN']));

      expect(reanchorBook).not.toHaveBeenCalled();
    });
  });

  describe('staleCoversDraft', () => {
    it('is false until the text is read', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs()));

      expect(result.current.staleCoversDraft).toBe(false);
    });

    it('is true once the text is read', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs()));

      act(() => result.current.onTextRead(['GEN', 'EXO']));

      expect(result.current.staleCoversDraft).toBe(true);
    });

    it('is false again once the draft is replaced', () => {
      const { result, rerender } = renderHook(
        (args: UseWholeTextReanchorArgs) => useWholeTextReanchor(args),
        { initialProps: makeArgs() },
      );
      act(() => result.current.onTextRead(['GEN', 'EXO']));

      rerender(makeArgs({ draftVersion: 2 }));

      expect(result.current.staleCoversDraft).toBe(false);
    });

    it('stays false for a text read while an import is shown', () => {
      const { result } = renderHook(() => useWholeTextReanchor(makeArgs({ isImportView: true })));

      act(() => result.current.onTextRead(['GEN', 'EXO']));

      expect(result.current.staleCoversDraft).toBe(false);
    });
  });
});
