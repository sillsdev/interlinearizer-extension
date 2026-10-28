/// <reference types="jest" />

import * as freeTranslationCommands from '../../services/commands/freeTranslationCommands';
import { RecordCache } from '../../cache/recordCache';
import { FIXTURE_STAMPS, makePhraseLink } from '../test-helpers';
import { comparable, GLOSSED, glossing, NOW, ref, sessionOver } from './session-source';

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

  it('asks for the outline again once a reply reaches a stale free translation', async () => {
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

    expect(cache.apply(reply)).toBe('outline');
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

  it('asks for the outline again once a reply removes a stale translation it holds', async () => {
    const { fetchPage, outline, edit } = await sessionOver(phrased);
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    const reply = await edit('discard', async (buffer) => {
      const [link] = await buffer.findLinksBySegment(['GEN 1:2']);
      buffer.delete('segmentAnalysisLinks', link);
    });

    expect(cache.apply(reply)).toBe('outline');
  });

  it('asks for nothing when a reply names the boundaries the book already has', async () => {
    const { fetchPage, outline, edit } = await sessionOver();
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);
    const rescope = (languages: string[]) =>
      edit('rescope', async (buffer) => {
        buffer.putScope({ ...(await buffer.getScope()), analysisLanguages: languages });
      });

    cache.apply(await rescope(['fr']));

    expect(cache.apply(await rescope(['de']))).toBe('none');
  });

  it('lets go of its pages when it takes a new outline', async () => {
    const { fetchPage, outline } = await sessionOver();
    const cache = new RecordCache(outline);
    cache.absorb(await fetchPage(0, 3), cache.revision);

    cache.replaceOutline(outline);

    expect(cache.holds(0)).toBe(false);
    expect(cache.outline).toBe(outline);
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

  it('applies a new free translation and the removal of one it never held without fetching again', async () => {
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
    const removed = await edit('remove', async (buffer) => {
      const [link] = await buffer.findLinksBySegment(['GEN 1:3']);
      buffer.delete('segmentAnalysisLinks', link);
    });

    expect(cache.apply(written)).toBe('none');
    expect(cache.apply(removed)).toBe('none');
    expect(comparable(cache.pageAt(0, 2))).toStrictEqual(comparable(await fetchPage(0, 2)));
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
