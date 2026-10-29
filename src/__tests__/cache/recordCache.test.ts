/// <reference types="jest" />

import * as discardCommands from '../../services/commands/discardCommands';
import * as freeTranslationCommands from '../../services/commands/freeTranslationCommands';
import { RecordCache } from '../../cache/recordCache';
import { FIXTURE_STAMPS, makePhraseLink, makeVerseBook } from '../test-helpers';
import { BOOK, comparable, GLOSSED, glossing, NOW, ref, sessionOver } from './session-source';

describe('RecordCache', () => {
  it('serves the pages it took in as they were fetched', async () => {
    const { fetchPage, outline } = await sessionOver();
    const cache = new RecordCache(outline);
    const page = await fetchPage(0, 3);

    cache.absorb(page, cache.revision);

    expect(comparable(cache.pageAt(0, 3))).toStrictEqual(comparable(page));
  });

  it('serves nothing for a range it holds only part of', async () => {
    const { fetchPage, outline } = await sessionOver();
    const cache = new RecordCache(outline);

    cache.absorb(await fetchPage(0, 1), cache.revision);

    expect(cache.pageAt(0, 2)).toBeUndefined();
  });

  it('gives the pages and pool buckets a refetch gives once a reply applies', async () => {
    const { fetchPage, outline, edit } = await sessionOver();
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    expect(cache.apply(await edit('writeGloss', glossing('earth', 'land')))).toBe('none');
    expect(cache.apply(await edit('writeGloss', glossing('God', '')))).toBe('none');

    expect(comparable(cache.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });

  it('keeps the records a reply wrote when a refetch sent before it lands', async () => {
    const { fetchPage, outline, edit } = await sessionOver();
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);
    const sentAt = cache.revision;
    const stale = await fetchPage(0, 3);

    cache.apply(await edit('writeGloss', glossing('earth', 'land')));
    cache.apply(await edit('writeGloss', glossing('God', '')));
    cache.absorb(stale, sentAt);

    expect(comparable(cache.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });

  it('asks for the outline again once a reply moves boundaries', async () => {
    const { fetchPage, outline, edit } = await sessionOver();
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    const reply = await edit('split', async (buffer) => {
      buffer.putScope({
        ...(await buffer.getScope()),
        segmentation: {
          removedVerseStarts: [],
          addedStarts: [{ tokenRef: ref('beginning'), surfaceText: 'beginning' }],
        },
      });
    });

    expect(cache.apply(reply)).toBe('outline');
  });

  it('asks for its pages and counts again once a reply reaches a stale free translation', async () => {
    const { fetchPage, outline, edit } = await sessionOver({
      segmentAnalyses: [
        { id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'x', freeTranslation: { en: 'old' } },
      ],
      segmentAnalysisLinks: [
        {
          id: 'sl-1',
          analysisId: 'sa-1',
          segmentId: 'GEN 1:9',
          status: 'stale',
          ...FIXTURE_STAMPS,
        },
      ],
    });
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    const reply = await edit('keep', (buffer) =>
      freeTranslationCommands.writeSegmentFreeTranslation(buffer, {
        segmentId: 'GEN 1:2',
        surfaceText: 'And the earth',
        value: 'new',
        analysisLanguage: 'en',
        adoptStaleAnalysisId: 'sa-1',
        analysisId: 'sa-new',
        linkId: 'sl-new',
        now: NOW,
      }),
    );

    expect(cache.apply(reply)).toBe('placement');
  });

  it('asks for nothing when the first reply naming boundaries leaves them as they were', async () => {
    const { fetchPage, outline, edit } = await sessionOver();
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    const reply = await edit('rescope', async (buffer) => {
      buffer.putScope({ ...(await buffer.getScope()), analysisLanguages: ['fr'] });
    });

    expect(cache.apply(reply)).toBe('none');
  });
});

describe('RecordCache with phrases and stale translations', () => {
  const phrased = {
    ...GLOSSED,
    phraseAnalyses: [{ id: 'pa', ...FIXTURE_STAMPS, surfaceText: 'the earth' }],
    phraseAnalysisLinks: [makePhraseLink('pl', [ref('the'), ref('beginning'), 'GEN 1:9:0'])],
    segmentAnalyses: ['sa-2', 'sa-9'].map((id) => ({ id, ...FIXTURE_STAMPS, surfaceText: id })),
    segmentAnalysisLinks: [
      {
        id: 'sl-2',
        analysisId: 'sa-2',
        segmentId: 'GEN 1:2',
        status: 'stale' as const,
        ...FIXTURE_STAMPS,
      },
      {
        id: 'sl-9',
        analysisId: 'sa-9',
        segmentId: 'GEN 1:9',
        status: 'stale' as const,
        ...FIXTURE_STAMPS,
      },
    ],
  };
  const phrase = (tokens: string[]) => ({ ...makePhraseLink('pl', tokens), analysisId: 'pa' });

  it('serves phrases, their spans and stale translations as fetched', async () => {
    const { fetchPage, outline } = await sessionOver(phrased);
    const cache = new RecordCache(outline);

    cache.absorb(await fetchPage(0, 3), cache.revision);

    expect(comparable(cache.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
    expect(comparable(cache.pageAt(1, 3))).toStrictEqual(comparable(await fetchPage(1, 3)));
  });

  it('applies a phrase over tokens it holds without fetching again', async () => {
    const { fetchPage, outline, edit } = await sessionOver(phrased);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    const reshaped = await edit('reshape', async (buffer) => {
      buffer.put('phraseAnalysisLinks', phrase([ref('earth'), ref('said')]));
    });
    const removed = await edit('remove', async (buffer) => {
      buffer.delete('phraseAnalysisLinks', phrase([ref('earth'), ref('said')]));
    });

    expect(cache.apply(reshaped)).toBe('none');
    expect(cache.apply(removed)).toBe('none');
    expect(comparable(cache.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });

  it('asks for its pages again for a phrase over a token it does not hold', async () => {
    const { fetchPage, outline, edit } = await sessionOver(phrased);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 1), cache.revision);

    const reply = await edit('reshape', async (buffer) => {
      buffer.put('phraseAnalysisLinks', phrase([ref('In'), ref('said')]));
    });

    expect(cache.apply(reply)).toBe('pages');
  });

  it('asks for its pages and counts again once a reply removes a stale translation it holds', async () => {
    const { fetchPage, outline, edit } = await sessionOver(phrased);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    const reply = await edit('discard', async (buffer) => {
      const [link] = await buffer.findLinksBySegment(['GEN 1:2']);
      buffer.delete('segmentAnalysisLinks', link);
    });

    expect(cache.apply(reply)).toBe('placement');
  });

  it('lets go of its pages when it takes a new outline', async () => {
    const { fetchPage, outline } = await sessionOver();
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    cache.replaceOutline(outline);

    expect(cache.holds(0)).toBe(false);
    expect(cache.outline).toBe(outline);
  });

  it('spans a phrase over only the words the text still holds once it takes a new outline', async () => {
    const shortened = makeVerseBook([
      { sid: 'GEN 1:1', text: 'In the beginning' },
      { sid: 'GEN 1:2', text: 'And the earth' },
      { sid: 'GEN 1:3', text: 'And God said' },
    ]);
    const { fetchPage, fetchOutline, outline } = await sessionOver({
      phraseAnalyses: [{ id: 'pa', ...FIXTURE_STAMPS, surfaceText: 'beginning God' }],
      phraseAnalysisLinks: [phrase([ref('beginning'), ref('God')])],
    });
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 1), cache.revision);

    cache.replaceOutline(await fetchOutline(shortened));
    cache.absorb(await fetchPage(0, 1, shortened), cache.revision);

    expect(comparable(cache.pageAt(0, 1))).toStrictEqual(
      comparable(await fetchPage(0, 1, shortened)),
    );
  });

  it('takes the counts of an outline that cuts the book as the held one does, keeping its pages', async () => {
    const { fetchPage, outline } = await sessionOver(phrased);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);
    const recounted = {
      ...outline,
      segments: outline.segments.map((segment) => ({ ...segment, orphanedCardCount: 2 })),
    };

    expect(cache.takeCounts(recounted)).toBe(true);
    expect(cache.outline).toBe(recounted);
    expect(cache.holds(0)).toBe(true);
  });

  it('takes nothing from an outline that cuts the book otherwise', async () => {
    const { fetchPage, outline } = await sessionOver(phrased);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    expect(cache.takeCounts({ ...outline, textVersion: 'other' })).toBe(false);
    expect(cache.outline).toBe(outline);
  });

  it('names the held segments whose pages read an analysis', async () => {
    const { fetchPage, outline } = await sessionOver(phrased);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    expect(cache.heldIndexesReading(['ta-god'], [])).toStrictEqual([0]);
    expect(cache.heldIndexesReading([phrased.phraseAnalysisLinks[0].analysisId], [])).toStrictEqual(
      [0],
    );
    expect(cache.heldIndexesReading(['sa-2'], [])).toStrictEqual([1]);
    expect(cache.heldIndexesReading(['sa-9'], [])).toStrictEqual([2]);
    expect(cache.heldIndexesReading(['ta-elsewhere'], [])).toStrictEqual([]);
  });

  it('names the held segments whose pages read the pool bucket of a form', async () => {
    const { fetchPage, outline } = await sessionOver(phrased);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    expect(cache.heldIndexesReading([], ['god'])).toStrictEqual([0, 2]);
  });
});

describe('RecordCache and free translations', () => {
  const translated = {
    segmentAnalyses: [
      { id: 'sa-3', ...FIXTURE_STAMPS, surfaceText: 'And God said', freeTranslation: { en: 'x' } },
    ],
    segmentAnalysisLinks: [
      {
        id: 'sl-3',
        analysisId: 'sa-3',
        segmentId: 'GEN 1:3',
        status: 'approved' as const,
        ...FIXTURE_STAMPS,
      },
    ],
  };

  it('applies a new free translation without fetching again', async () => {
    const { fetchPage, outline, edit } = await sessionOver(translated);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 2), cache.revision);

    const written = await edit('write', (buffer) =>
      freeTranslationCommands.writeSegmentFreeTranslation(buffer, {
        segmentId: 'GEN 1:1',
        surfaceText: 'In the beginning God',
        value: 'first',
        analysisLanguage: 'en',
        analysisId: 'sa-1',
        linkId: 'sl-1',
        now: NOW,
      }),
    );

    expect(cache.apply(written)).toBe('none');
    expect(comparable(cache.pageAt(0, 2))).toStrictEqual(comparable(await fetchPage(0, 2)));
  });

  it('applies the removal of a free translation it never held without fetching again', async () => {
    const { fetchPage, outline, edit } = await sessionOver(translated);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 2), cache.revision);

    const removed = await edit('remove', async (buffer) => {
      const [link] = await buffer.findLinksBySegment(['GEN 1:3']);
      buffer.delete('segmentAnalysisLinks', link);
    });

    expect(cache.apply(removed)).toBe('none');
    expect(comparable(cache.pageAt(0, 2))).toStrictEqual(comparable(await fetchPage(0, 2)));
  });

  it('asks for its pages and counts again once a reply removes a stale free translation it never held', async () => {
    const { fetchPage, outline, edit } = await sessionOver({
      ...translated,
      segmentAnalysisLinks: [{ ...translated.segmentAnalysisLinks[0], status: 'stale' as const }],
    });
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 2), cache.revision);

    const removed = await edit('remove', async (buffer) => {
      const [link] = await buffer.findLinksBySegment(['GEN 1:3']);
      buffer.delete('segmentAnalysisLinks', link);
    });

    expect(cache.apply(removed)).toBe('placement');
  });

  it('lets go of a record a page fetched later no longer holds', async () => {
    const { fetchPage, outline, edit } = await sessionOver();
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);
    await edit('writeGloss', glossing('God', ''));

    cache.absorb(await fetchPage(0, 3), cache.revision);

    expect(comparable(cache.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });
});

describe('RecordCache and discards', () => {
  const analyzed = {
    ...GLOSSED,
    phraseAnalyses: [{ id: 'pa', ...FIXTURE_STAMPS, surfaceText: 'the earth' }],
    phraseAnalysisLinks: [
      { ...makePhraseLink('pl', [ref('the'), ref('beginning')]), analysisId: 'pa' },
    ],
    segmentAnalyses: [
      { id: 'sa-2', ...FIXTURE_STAMPS, surfaceText: 'And the earth', freeTranslation: { en: 'x' } },
    ],
    segmentAnalysisLinks: [
      {
        id: 'sl-2',
        analysisId: 'sa-2',
        segmentId: 'GEN 1:2',
        status: 'approved' as const,
        ...FIXTURE_STAMPS,
      },
    ],
  };

  it('gives the pages a refetch gives once a reply discards the book', async () => {
    const { fetchPage, outline, edit } = await sessionOver(analyzed);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    const reply = await edit('discardBook', async (buffer, session) => {
      discardCommands.discardBook(buffer, await session.repository.exportAll(), 'GEN', undefined);
      return { reanchorTo: [BOOK] };
    });

    expect(cache.apply(reply)).toBe('none');
    expect(comparable(cache.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });

  it('gives the pages a refetch gives once a reply discards every change', async () => {
    const { fetchPage, outline, edit } = await sessionOver(analyzed);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    const reply = await edit('discardAll', async (buffer, session) => {
      discardCommands.discardAll(buffer, await session.repository.exportAll(), undefined);
      return { reanchorTo: [BOOK] };
    });

    expect(cache.apply(reply)).toBe('none');
    expect(comparable(cache.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });

  it('asks for the outline again once a discard restores the boundaries', async () => {
    const { fetchPage, outline, edit } = await sessionOver(analyzed, {
      removedVerseStarts: [],
      addedStarts: [{ tokenRef: ref('beginning'), surfaceText: 'beginning' }],
    });
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    const reply = await edit('discardBook', async (buffer, session) => {
      discardCommands.discardBook(buffer, await session.repository.exportAll(), 'GEN', undefined);
      return { reanchorTo: [BOOK] };
    });

    expect(cache.apply(reply)).toBe('outline');
  });
});
