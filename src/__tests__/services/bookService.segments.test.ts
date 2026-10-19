/// <reference types="jest" />

import papiBackendMock from '@papi/backend';
import type { Book, SegmentationDelta } from 'interlinearizer';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import type { UsjDocument } from 'parsers/papi/usjBookExtractor';
import { createRng, type Rng } from '../../../perf/dataset/rng';
import {
  closeAllProjects,
  getBookOutline,
  getSegments,
  getTokenizedBook,
} from '../../services/bookService';
import type { BookOutline, SegmentPage } from '../../types/segment-pages';
import { buildBookOutline } from '../../utils/book-outline';
import {
  addBoundaryBefore,
  reanchorSegmentation,
  removeBoundaryAt,
  segmentationForBook,
} from '../../utils/segmentation';

function isBackendMock(m: unknown): m is { __mockProjectDataProvidersGet: jest.Mock } {
  return !!m && typeof m === 'object' && '__mockProjectDataProvidersGet' in m;
}

if (!isBackendMock(papiBackendMock)) throw new Error('Expected mocked @papi/backend');
const { __mockProjectDataProvidersGet: mockPdpGet } = papiBackendMock;

const SEEDS = Array.from({ length: 200 }, (_unused, i) => i);

const WORDS = ['light', 'day', 'water', 'and', 'God', 'said', 'good', 'earth', 'the', 'night'];

type VerseText = {
  words: string[];
  heading?: {
    /** Index of the word the heading falls ahead of; the word count places it after the last. */
    at: number;
    text: string;
  };
};

/** A book's verses, by chapter. */
type BookText = VerseText[][];

function intBelow(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[intBelow(rng, items.length)];
}

function generateText(rng: Rng): BookText {
  return Array.from({ length: 1 + intBelow(rng, 3) }, () =>
    Array.from({ length: 1 + intBelow(rng, 8) }, () => {
      // Some verses carry no text, which leaves the verse after them nothing to merge into.
      const words = Array.from({ length: rng() < 0.1 ? 0 : 1 + intBelow(rng, 6) }, () =>
        pick(rng, WORDS),
      );
      if (words.length > 0 && rng() < 0.4) words[words.length - 1] += '.';
      if (rng() >= 0.2) return { words };
      return { words, heading: { at: intBelow(rng, words.length + 1), text: pick(rng, WORDS) } };
    }),
  );
}

/** The chapter and verse indexes of the verses `draft` sets Genesis boundaries in. */
function versesWithBoundaries(draft: SegmentationDelta | undefined): [number, number][] {
  if (!draft) return [];
  return [...draft.removedVerseStarts, ...draft.addedStarts.map((start) => start.tokenRef)]
    .filter((ref) => ref.startsWith('GEN '))
    .map((ref) => {
      const [chapter, verse] = ref.slice('GEN '.length).split(':').map(Number);
      return [chapter - 1, verse - 1];
    });
}

/**
 * `text` with one word of one verse inserted, deleted or replaced, mostly in a verse of `targets`,
 * where an edit moves the boundaries set in it.
 */
function editText(rng: Rng, text: BookText, targets: readonly [number, number][]): BookText {
  const edited = text.map((verses) =>
    verses.map(({ words, heading }) => ({ words: [...words], heading })),
  );
  const target = targets.length > 0 && rng() < 0.7 ? pick(rng, targets) : undefined;
  const verse = target ? edited[target[0]][target[1]] : pick(rng, edited.flat());
  // An edit moves only the boundaries after it, so one in a target mostly falls at its start.
  const reach = target && rng() < 0.5 ? Math.min(1, verse.words.length) : verse.words.length;
  const at = intBelow(rng, reach + 1);
  const op = verse.words.length === 0 ? 0 : intBelow(rng, 3);
  if (op === 0) verse.words.splice(at, 0, pick(rng, WORDS));
  else if (op === 1) verse.words.splice(Math.min(at, verse.words.length - 1), 1);
  else verse.words[Math.min(at, verse.words.length - 1)] = pick(rng, WORDS);
  if (verse.heading)
    verse.heading = { ...verse.heading, at: Math.min(verse.heading.at, verse.words.length) };
  return edited;
}

function usjOf(text: BookText): UsjDocument {
  const content: UsjDocument['content'] = [
    { type: 'book', marker: 'id', code: 'GEN', content: [] },
  ];
  text.forEach((verses, c) => {
    const chapter = c + 1;
    content.push({ type: 'chapter', marker: 'c', number: `${chapter}`, sid: `GEN ${chapter}` });
    let para: UsjDocument['content'] = [];
    const breakPara = () => {
      if (para.length > 0) content.push({ type: 'para', marker: 'p', content: para });
      para = [];
    };
    const addHeading = (heading: string) => {
      breakPara();
      content.push({ type: 'para', marker: 's1', content: [heading] });
    };
    verses.forEach(({ words, heading }, v) => {
      if (heading?.at === 0) addHeading(heading.text);
      para.push({ type: 'verse', marker: 'v', number: `${v + 1}`, sid: `GEN ${chapter}:${v + 1}` });
      if (!heading || heading.at === 0) {
        para.push(`${words.join(' ')} `);
        return;
      }
      para.push(`${words.slice(0, heading.at).join(' ')} `);
      addHeading(heading.text);
      if (heading.at < words.length) para.push(`${words.slice(heading.at).join(' ')} `);
    });
    breakPara();
  });
  return { content };
}

/** `delta` with one boundary edit made: a split before any token, or a merge at a segment's start. */
function editBoundaries(
  rng: Rng,
  book: Book,
  delta: SegmentationDelta | undefined,
): SegmentationDelta | undefined {
  const verseSegments = book.segments.filter((segment) => !segment.heading);
  const tokenRefs = verseSegments.flatMap((segment) => segment.tokens.map((token) => token.ref));
  if (tokenRefs.length === 0) return delta;
  if (rng() < 0.5) return addBoundaryBefore(book, delta, pick(rng, tokenRefs));
  const startRefs = resegmentBook(book, delta)
    .segments.filter((segment) => !segment.heading)
    .flatMap((segment) => (segment.tokens[0] ? [segment.tokens[0].ref] : []));
  return removeBoundaryAt(book, delta, pick(rng, startRefs));
}

/** A draft's boundaries in another book, which the WebView's delta carries and the host's omits. */
const EXODUS_BOUNDARIES: SegmentationDelta = {
  removedVerseStarts: ['EXO 1:2:0'],
  addedStarts: [{ tokenRef: 'EXO 1:1:4', surfaceText: 'light' }],
};

/** Serves the project's text for Genesis, and returns a function that edits it. */
function serveText(initial: BookText): (text: BookText) => Promise<void> {
  let usj = usjOf(initial);
  const deliveries: ((usj: UsjDocument) => void)[] = [];
  const subscribeBookUSJ = async (_selector: unknown, deliver: (usj: UsjDocument) => void) => {
    deliveries.push(deliver);
    queueMicrotask(() => deliver(usj));
    return async () => true;
  };
  mockPdpGet.mockImplementation(async (type: string) =>
    type === 'platform.base' ? { getSetting: async () => 'en' } : { subscribeBookUSJ },
  );
  return async (text) => {
    usj = usjOf(text);
    deliveries.forEach((deliver) => deliver(usj));
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  };
}

async function tokenizedBook(): Promise<Book> {
  const json = await getTokenizedBook('src', 'GEN');
  if (!json) throw new Error('Expected a tokenized book');
  return JSON.parse(json);
}

/** The host's outline and pages, as JSON, for the boundaries the WebView sends it for `draft`. */
async function hostSegments(draft: SegmentationDelta | undefined): Promise<string> {
  const delta = segmentationForBook(draft, 'GEN');
  const segmentationJson = delta && JSON.stringify(delta);
  const outlineJson = await getBookOutline('src', 'GEN', segmentationJson);
  if (!outlineJson) throw new Error('Expected an outline');
  const outline: BookOutline = JSON.parse(outlineJson);
  const pageJson = await getSegments('src', 'GEN', 0, outline.segments.length, segmentationJson);
  if (!pageJson) throw new Error('Expected a page');
  const page: SegmentPage = JSON.parse(pageJson);
  return JSON.stringify({ outline, segments: page.segments });
}

/** The WebView's whole book for `draft`, as JSON in the shape of {@link hostSegments}. */
function webViewSegments(book: Book, draft: SegmentationDelta | undefined): string {
  const { segments } = resegmentBook(book, reanchorSegmentation(book, draft));
  return JSON.stringify({ outline: buildBookOutline(book, segments), segments });
}

afterEach(() => closeAllProjects());

describe("the host's segments", () => {
  it("match the WebView's whole book under custom boundaries, after a Scripture edit, and after a boundary edit", async () => {
    const mismatches: string[] = [];
    await SEEDS.reduce(async (prior, seed) => {
      await prior;
      const rng = createRng('host-segments', seed);
      const text = generateText(rng);
      const editScripture = serveText(text);
      const check = async (state: string, book: Book, draft: SegmentationDelta | undefined) => {
        if ((await hostSegments(draft)) !== webViewSegments(book, draft))
          mismatches.push(`seed ${seed}, ${state}`);
      };

      const before = await tokenizedBook();
      let draft = rng() < 0.3 ? EXODUS_BOUNDARIES : undefined;
      Array.from({ length: 1 + intBelow(rng, 6) }).forEach(() => {
        draft = editBoundaries(rng, before, draft);
      });
      await check('custom boundaries', before, draft);

      await editScripture(editText(rng, text, versesWithBoundaries(draft)));
      const after = await tokenizedBook();
      await check('after a Scripture edit', after, draft);
      // The WebView then writes the boundaries, re-anchored to the edited text, back to its draft.
      draft = reanchorSegmentation(after, draft);
      await check('once the draft is re-anchored', after, draft);

      draft = editBoundaries(rng, after, draft);
      await check('after a boundary edit', after, draft);
      await closeAllProjects();
    }, Promise.resolve());

    expect(mismatches).toEqual([]);
  });
});
