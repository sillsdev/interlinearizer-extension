/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { Collator } from 'platform-bible-utils';
import ConcordanceRowView, {
  CONCORDANCE_ROW_STRING_KEYS,
} from '../../components/ConcordanceRowView';
import {
  approvedAnalysisByToken,
  buildConcordanceEntries,
  deriveConcordanceRows,
  indexBook,
  type ConcordanceOccurrence,
} from '../../utils/concordance';
import { FIXTURE_STAMPS, makeVerseBook } from '../test-helpers';
import { withTooltipProvider } from './test-helpers';

const localizedStrings = Object.fromEntries(CONCORDANCE_ROW_STRING_KEYS.map((k) => [k, k]));

/** Builds an approved link from `tokenRef` to the analysis. */
function link(analysisId: string, tokenRef: string): TokenAnalysisLink {
  return {
    ...FIXTURE_STAMPS,
    analysisId,
    status: 'approved',
    token: { tokenRef, surfaceText: 'light' },
  };
}

/** Builds a token analysis glossed in English, or unglossed when no gloss is given. */
function analysis(id: string, gloss?: string): TokenAnalysis {
  return { ...FIXTURE_STAMPS, id, surfaceText: 'light', gloss: gloss ? { en: gloss } : undefined };
}

type RowOptions = Partial<{
  verses: { sid: string; text: string }[];
  links: TokenAnalysisLink[];
  analyses: TokenAnalysis[];
  currentBook: string;
  isSelected: boolean;
  onOccurrenceSelect: (form: string, occurrence: ConcordanceOccurrence) => void;
}>;

/** Renders the row for the form "light" in the given text. */
function renderRow(options: RowOptions = {}) {
  const verses = options.verses ?? [{ sid: 'GEN 1:3', text: 'Let there be light' }];
  const entries = buildConcordanceEntries([indexBook(makeVerseBook(verses))], new Collator('en'));
  const approvedByToken = approvedAnalysisByToken(options.links ?? []);
  const row = deriveConcordanceRows(entries, approvedByToken, options.currentBook ?? 'GEN').find(
    (r) => r.entry.form === 'light',
  );
  if (!row) throw new Error('the text has no "light" to list');
  return render(
    withTooltipProvider(
      <ul>
        <ConcordanceRowView
          analysesById={new Map((options.analyses ?? []).map((a) => [a.id, a]))}
          analysisLanguage="en"
          approvedByToken={approvedByToken}
          isSelected={options.isSelected ?? false}
          localizedStrings={localizedStrings}
          occurrenceCountInBookLabel="in Genesis"
          onOccurrenceSelect={options.onOccurrenceSelect ?? (() => {})}
          row={row}
          sourceLanguageTag="hbo"
        />
      </ul>,
    ),
  );
}

/** "light" once in each of three verses. */
const LIGHT_VERSES = [
  { sid: 'GEN 1:3', text: 'light' },
  { sid: 'GEN 1:4', text: 'light' },
  { sid: 'GEN 1:5', text: 'light' },
];

async function expand(): Promise<void> {
  await userEvent.click(screen.getByTestId('concordance-row-toggle'));
}

describe('ConcordanceRowView', () => {
  it('shows the form by its display spelling, in the source language', () => {
    renderRow({ verses: [{ sid: 'GEN 1:1', text: 'Light light' }] });

    const form = screen.getByTestId('concordance-row-form');
    expect(form).toHaveTextContent('Light');
    expect(form).toHaveAttribute('lang', 'hbo');
  });

  it('shows how often the form occurs in the whole text and in the current book', () => {
    renderRow({ verses: LIGHT_VERSES });

    expect(screen.getByTestId('concordance-row-count')).toHaveTextContent('3');
    expect(screen.getByTestId('concordance-row-count-in-book')).toHaveTextContent('3');
  });

  it('spells out what each count means for assistive tech', () => {
    renderRow({ verses: LIGHT_VERSES });

    expect(screen.getByTestId('concordance-row-count')).toHaveTextContent(
      '%interlinearizer_concordance_occurrenceCount%',
    );
    expect(screen.getByTestId('concordance-row-count-in-book')).toHaveTextContent('in Genesis');
  });

  it.each([
    ['analyzed', ['GEN 1:3:0', 'GEN 1:4:0', 'GEN 1:5:0'], 'circle-check-icon'],
    ['partlyAnalyzed', ['GEN 1:3:0'], 'circle-dashed-icon'],
    ['unanalyzed', [], 'circle-icon'],
  ])('marks a %s form with its own icon and label', (status, refs, icon) => {
    renderRow({ verses: LIGHT_VERSES, links: refs.map((ref) => link('a1', ref)) });

    const marker = screen.getByTestId('concordance-row-status');
    expect(marker).toHaveAttribute('data-status', status);
    expect(within(marker).getByTestId(icon)).toBeInTheDocument();
    expect(marker).toHaveTextContent(`%interlinearizer_concordance_status_${status}%`);
  });

  it('marks the row the view was last jumped from', () => {
    renderRow({ isSelected: true });

    expect(screen.getByTestId('concordance-row')).toHaveAttribute('data-selected', 'true');
  });

  it('keeps the occurrences hidden until the row is expanded', () => {
    renderRow();

    expect(screen.queryByTestId('concordance-row-detail')).not.toBeInTheDocument();
  });

  describe('expanded', () => {
    it('lists each analysis with how many occurrences it covers, most used first', async () => {
      renderRow({
        verses: LIGHT_VERSES,
        links: [link('lamp', 'GEN 1:3:0'), link('light', 'GEN 1:4:0'), link('light', 'GEN 1:5:0')],
        analyses: [analysis('lamp', 'lamp'), analysis('light', 'light')],
      });

      await expand();

      expect(screen.getAllByTestId('concordance-tally').map((t) => t.textContent)).toEqual([
        'light 2',
        'lamp 1',
      ]);
    });

    it('lists an analysis with no gloss as unglossed', async () => {
      renderRow({ links: [link('a1', 'GEN 1:3:13')], analyses: [analysis('a1')] });

      await expand();

      expect(screen.getByTestId('concordance-tally')).toHaveTextContent(
        '%interlinearizer_concordance_noGloss%',
      );
    });

    it('counts the occurrences no analysis covers', async () => {
      renderRow({
        verses: LIGHT_VERSES,
        links: [link('a1', 'GEN 1:3:0')],
        analyses: [analysis('a1', 'light')],
      });

      await expand();

      expect(screen.getByTestId('concordance-tally-unanalyzed')).toHaveTextContent(
        '%interlinearizer_concordance_unanalyzed% 2',
      );
    });

    it('omits the unanalyzed count when every occurrence is analyzed', async () => {
      renderRow({ links: [link('a1', 'GEN 1:3:13')], analyses: [analysis('a1', 'light')] });

      await expand();

      expect(screen.queryByTestId('concordance-tally-unanalyzed')).not.toBeInTheDocument();
    });

    it('lists each occurrence by reference within its verse, the form marked', async () => {
      renderRow();

      await expand();

      const occurrence = screen.getByTestId('concordance-occurrence');
      expect(occurrence).toHaveTextContent('GEN 1:3');
      const context = within(occurrence).getByTestId('concordance-context');
      expect(context).toHaveAttribute('lang', 'hbo');
      expect(context).toHaveTextContent('Let there be light');
      expect(context.querySelector('mark')).toHaveTextContent('light');
    });

    it('marks where a long verse was cut short', async () => {
      const filler = 'and the evening and the morning were the first day of all';
      renderRow({ verses: [{ sid: 'GEN 1:5', text: `${filler} light light ${filler}` }] });

      await expand();

      const [first] = screen.getAllByTestId('concordance-context');
      expect(first.textContent?.startsWith('…')).toBe(true);
      expect(first.textContent?.endsWith('…')).toBe(true);
    });

    it('reads a line break in the verse as a space', async () => {
      renderRow({ verses: [{ sid: 'GEN 1:3', text: 'there\nwas light' }] });

      await expand();

      expect(screen.getByTestId('concordance-context')).toHaveTextContent('there was light');
    });

    it('shows the gloss an analyzed occurrence carries', async () => {
      renderRow({ links: [link('a1', 'GEN 1:3:13')], analyses: [analysis('a1', 'light')] });

      await expand();

      expect(screen.getByTestId('concordance-occurrence-gloss')).toHaveTextContent('light');
    });

    it('shows an analyzed occurrence with no gloss as unglossed', async () => {
      renderRow({ links: [link('a1', 'GEN 1:3:13')], analyses: [analysis('a1')] });

      await expand();

      expect(screen.getByTestId('concordance-occurrence-gloss')).toHaveTextContent(
        '%interlinearizer_concordance_noGloss%',
      );
    });

    it('marks an unanalyzed occurrence', async () => {
      renderRow();

      await expand();

      expect(screen.getByTestId('concordance-occurrence-gloss')).toHaveTextContent(
        '%interlinearizer_concordance_unanalyzed%',
      );
    });

    it('reports the occurrence a reader picks', async () => {
      const onOccurrenceSelect = jest.fn();
      renderRow({ onOccurrenceSelect });

      await expand();
      await userEvent.click(screen.getByTestId('concordance-occurrence'));

      expect(onOccurrenceSelect).toHaveBeenCalledWith(
        'light',
        expect.objectContaining({ tokenRef: 'GEN 1:3:13' }),
      );
    });

    describe('with many occurrences', () => {
      /** "light" once in each of `count` verses. */
      function manyVerses(count: number) {
        return Array.from({ length: count }, (_unused, index) => ({
          sid: `GEN ${Math.floor(index / 100) + 1}:${(index % 100) + 1}`,
          text: 'light',
        }));
      }

      it('lists only the first occurrences, offering more behind an expander', async () => {
        renderRow({ verses: manyVerses(20) });

        await expand();

        expect(screen.getAllByTestId('concordance-occurrence').length).toBeLessThan(20);
        expect(screen.getByTestId('concordance-occurrences-show-more')).toHaveTextContent(
          '%interlinearizer_concordance_showMoreOccurrences%',
        );
      });

      it('lists the rest once the expander is used, when they fit in one more page', async () => {
        renderRow({ verses: manyVerses(20) });

        await expand();
        await userEvent.click(screen.getByTestId('concordance-occurrences-show-more'));

        expect(screen.getAllByTestId('concordance-occurrence')).toHaveLength(20);
        expect(screen.queryByTestId('concordance-occurrences-show-more')).not.toBeInTheDocument();
      });

      it('lists one more page at a time when the rest do not fit in one', async () => {
        renderRow({ verses: manyVerses(300) });

        await expand();
        const before = screen.getAllByTestId('concordance-occurrence').length;
        await userEvent.click(screen.getByTestId('concordance-occurrences-show-more'));

        const after = screen.getAllByTestId('concordance-occurrence').length;
        expect(after).toBeGreaterThan(before);
        expect(after).toBeLessThan(300);
        expect(screen.getByTestId('concordance-occurrences-show-more')).toBeInTheDocument();
      });

      it('returns to the first occurrences when collapsed and expanded again', async () => {
        renderRow({ verses: manyVerses(20) });

        await expand();
        await userEvent.click(screen.getByTestId('concordance-occurrences-show-more'));
        await expand();
        await expand();

        expect(screen.getAllByTestId('concordance-occurrence').length).toBeLessThan(20);
      });
    });
  });
});
