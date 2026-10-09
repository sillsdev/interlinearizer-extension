import type {
  Book,
  MorphemeAnalysis,
  PhraseAnalysis,
  PhraseAnalysisLink,
  Segment,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  Token,
  TokenAnalysis,
  TokenAnalysisLink,
  TokenSnapshot,
} from 'interlinearizer';
import { normalizeSurfaceForm } from '../../src/utils/analysis-identity';
import { chance, createRng, intBetween, type Rng, uuid } from './rng';
import type { TierSpec } from './tiers';

/** Inputs every generated record depends on besides the tier's shares. */
export interface GenerateOptions {
  seed: number;
  analysisLanguage: string;
}

const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');

/** A stale snapshot's spelling, one no token of the text carries. */
function staleSpelling(surfaceText: string): string {
  return `${surfaceText}q`;
}

/** A gloss of `form`'s given sense, about as long as the word it glosses. */
function glossOf(form: string, sense: number): string {
  const reversed = [...form].reverse().join('');
  return sense === 0 ? reversed : `${reversed}/${sense + 1}`;
}

/** How many senses `form` has: one for most words, a few for some. */
function senseCount(seed: number, form: string): number {
  const draw = createRng(seed, 'senses', form)();
  if (draw < 0.7) return 1;
  return draw < 0.9 ? 2 : 3;
}

function isWord(token: Token): boolean {
  return token.type === 'word';
}

function snapshotOf(token: Token): TokenSnapshot {
  return { tokenRef: token.ref, surfaceText: token.surfaceText };
}

/**
 * Builds a draft analysis over `books` shaped by `spec`, the same one every time for a given seed.
 *
 * Payloads are keyed by content, as the app shares them, so one payload backs its occurrences
 * across every book. Stale links are stored already stale, the steady state a past re-anchor
 * leaves, so loading a dataset gives the re-anchor pass work without making it write.
 */
export function generateAnalysis(
  books: Book[],
  spec: TierSpec,
  { seed, analysisLanguage }: GenerateOptions,
): TextAnalysis {
  const tokenAnalyses = new Map<string, TokenAnalysis>();
  const phraseAnalyses = new Map<string, PhraseAnalysis>();
  const tokenAnalysisLinks: TokenAnalysisLink[] = [];
  const phraseAnalysisLinks: PhraseAnalysisLink[] = [];
  const segmentAnalyses: SegmentAnalysis[] = [];
  const segmentAnalysisLinks: SegmentAnalysisLink[] = [];

  let clock = 0;
  const nextStamp = (rng: Rng): string => {
    clock += intBetween(rng, 1, 90_000);
    return new Date(EPOCH + clock).toISOString();
  };

  const tokenPayload = (
    surfaceText: string,
    writingSystem: string,
    sense: number,
    rng: Rng,
  ): TokenAnalysis => {
    const form = normalizeSurfaceForm(surfaceText);
    const key = `${form}\u0000${sense}`;
    const existing = tokenAnalyses.get(key);
    if (existing) return existing;
    const idRng = createRng(seed, 'token-payload', key);
    const stamp = nextStamp(rng);
    const payload: TokenAnalysis = {
      id: uuid(idRng),
      createdAt: stamp,
      updatedAt: stamp,
      surfaceText,
      gloss: { [analysisLanguage]: glossOf(form, sense) },
    };
    if (form.length > 3 && chance(idRng, spec.morphemeShare)) {
      const cut = Math.ceil(form.length / 2);
      payload.morphemes = [form.slice(0, cut), form.slice(cut)].map(
        (part, index): MorphemeAnalysis => ({
          id: uuid(idRng),
          form: index === 0 ? part : `-${part}`,
          writingSystem,
          gloss: { [analysisLanguage]: glossOf(part, 0) },
        }),
      );
    }
    tokenAnalyses.set(key, payload);
    return payload;
  };

  const linkToken = (
    token: Token,
    surfaceText: string,
    sense: number,
    status: TokenAnalysisLink['status'],
    rng: Rng,
  ) => {
    const payload = tokenPayload(surfaceText, token.writingSystem, sense, rng);
    const stamp = nextStamp(rng);
    tokenAnalysisLinks.push({
      analysisId: payload.id,
      createdAt: stamp,
      updatedAt: stamp,
      status,
      token: { tokenRef: token.ref, surfaceText },
    });
  };

  const linkPhrase = (tokens: Token[], rng: Rng) => {
    const snapshots = tokens.map(snapshotOf);
    const surfaceText = snapshots.map((s) => s.surfaceText).join(' ');
    const key = normalizeSurfaceForm(surfaceText);
    let payload = phraseAnalyses.get(key);
    if (!payload) {
      const stamp = nextStamp(rng);
      payload = {
        id: uuid(createRng(seed, 'phrase-payload', key)),
        createdAt: stamp,
        updatedAt: stamp,
        surfaceText,
        gloss: { [analysisLanguage]: glossOf(key, 0) },
      };
      phraseAnalyses.set(key, payload);
    }
    const stamp = nextStamp(rng);
    phraseAnalysisLinks.push({
      id: uuid(rng),
      analysisId: payload.id,
      createdAt: stamp,
      updatedAt: stamp,
      status: 'approved',
      tokens: snapshots,
    });
  };

  const translateSegment = (segment: Segment, rng: Rng) => {
    const stale = chance(rng, spec.staleShare);
    const stamp = nextStamp(rng);
    const id = uuid(rng);
    segmentAnalyses.push({
      id,
      createdAt: stamp,
      updatedAt: stamp,
      surfaceText: stale ? staleSpelling(segment.baselineText) : segment.baselineText,
      freeTranslation: {
        [analysisLanguage]: segment.baselineText.split(/\s+/).reverse().join(' '),
      },
    });
    segmentAnalysisLinks.push({
      analysisId: id,
      segmentId: segment.id,
      createdAt: stamp,
      updatedAt: stamp,
      status: stale ? 'stale' : 'approved',
    });
  };

  books.forEach((book) => {
    const rng = createRng(seed, spec.coverage, 'book', book.bookRef);
    const inPhrase = new Set<string>();
    const segmentWords = book.segments.map((segment) => segment.tokens.filter(isWord));

    book.segments.forEach((segment, segmentIndex) => {
      if (chance(rng, spec.freeTranslationShare)) translateSegment(segment, rng);
      const words = segmentWords[segmentIndex];

      words.forEach((token, wordIndex) => {
        if (!chance(rng, spec.coverage)) return;
        const senses = senseCount(seed, normalizeSurfaceForm(token.surfaceText));
        const sense = intBetween(rng, 0, senses - 1);

        if (chance(rng, spec.staleShare)) {
          linkToken(token, staleSpelling(token.surfaceText), sense, 'stale', rng);
        } else {
          linkToken(token, token.surfaceText, sense, 'approved', rng);
          if (chance(rng, spec.competingShare)) {
            const rival = (sense + 1) % Math.max(2, senses);
            const status = chance(rng, 0.5) ? 'suggested' : 'rejected';
            linkToken(token, token.surfaceText, rival, status, rng);
          }
        }

        if (inPhrase.has(token.ref) || !chance(rng, spec.phraseShare)) return;
        const next = book.segments[segmentIndex + 1];
        const nextWords =
          next && !next.heading && !segment.heading ? segmentWords[segmentIndex + 1] : [];
        const run =
          wordIndex === words.length - 1 &&
          nextWords.length > 0 &&
          chance(rng, spec.crossSegmentPhraseShare)
            ? [token, nextWords[0]]
            : words.slice(wordIndex, wordIndex + intBetween(rng, 2, 3));
        if (run.length < 2 || run.some((t) => inPhrase.has(t.ref))) return;
        run.forEach((t) => inPhrase.add(t.ref));
        linkPhrase(run, rng);
      });
    });
  });

  return {
    segmentAnalyses,
    segmentAnalysisLinks,
    tokenAnalyses: [...tokenAnalyses.values()],
    tokenAnalysisLinks,
    phraseAnalyses: [...phraseAnalyses.values()],
    phraseAnalysisLinks,
  };
}
