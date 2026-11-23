/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SenseRef } from 'interlinearizer';
import type { ResolvedSense, SenseCandidate, SenseQuery } from 'interlinearizer/lexicon';
import { TooltipProvider } from 'platform-bible-react';
import type { ComponentProps } from 'react';
import CatalogSenseControl, {
  SENSE_CONTROL_STRING_KEYS,
} from '../../components/CatalogSenseControl';
import { LexiconSensesProvider } from '../../components/LexiconSenses';
import { createLexiconRegistry } from '../../utils/lexicon-resolvers';
import { nullLexiconResolver } from '../test-helpers';
import { TEST_LEXICON_AUTHORITY, testSenseRef } from './test-helpers';

/** Each string is its own key without the decoration, so a test finds a control by that name. */
const STRINGS: Record<string, string> = {
  ...Object.fromEntries(
    SENSE_CONTROL_STRING_KEYS.map((key) => [
      key,
      key.replace(/^%interlinearizer_analysisCatalog_|%$/g, ''),
    ]),
  ),
  '%interlinearizer_analysisCatalog_senseDiffers%': 'differs {gloss}',
  '%interlinearizer_analysisCatalog_senseKeepPrompt%': 'keep {gloss}?',
  '%interlinearizer_analysisCatalog_senseLexiconGloss%': 'lexicon says {gloss}',
  '%interlinearizer_analysisCatalog_senseQueryFormContains%': 'form contains {text}',
  '%interlinearizer_analysisCatalog_senseQueryFormExact%': 'form is {text}',
  '%interlinearizer_analysisCatalog_senseQueryGlossContains%': '{language} gloss contains {text}',
  '%interlinearizer_analysisCatalog_senseQueryGlossExact%': '{language} gloss is {text}',
  '%interlinearizer_analysisCatalog_senseRefineGloss%': '{language} gloss',
};

/** The search a popover opens on: entries whose form contains `agua`, in any writing system. */
const FORM_QUERY: SenseQuery = { text: 'agua', field: 'form', exact: false };

const SENSES: Record<string, ResolvedSense> = {
  's-1': { gloss: { en: 'water' } },
  's-2': { gloss: { en: 'rain' } },
  's-fr': { gloss: { fr: 'eau' } },
};

/** A search hit for the sense `senseId`. */
function candidate(senseId: string, overrides: Partial<SenseCandidate> = {}): SenseCandidate {
  return {
    gloss: { en: senseId },
    entryRef: { authority: TEST_LEXICON_AUTHORITY, entryId: `e-${senseId}` },
    senseRef: testSenseRef(senseId),
    ...overrides,
  };
}

/** A promise a test settles itself. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { promise, resolve, reject };
}

/** Lets pending look-ups settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * Renders the control beside a lexicon holding {@link SENSES}. The lexicon can search unless
 * `lexicon` says otherwise, and answers searches with `searchSenses`.
 */
function renderControl(
  props: Partial<ComponentProps<typeof CatalogSenseControl>> = {},
  lexicon: {
    canSearch?: boolean;
    searchSenses?: (query: SenseQuery) => Promise<SenseCandidate[]>;
    resolveSense?: (ref: SenseRef) => Promise<ResolvedSense | undefined>;
  } = {},
) {
  const {
    canSearch = true,
    searchSenses = jest.fn(async () => [candidate('s-1')]),
    resolveSense = jest.fn(async ({ senseId }: SenseRef) => SENSES[senseId]),
  } = lexicon;
  const registry = createLexiconRegistry([
    {
      ...nullLexiconResolver,
      authorities: [TEST_LEXICON_AUTHORITY],
      capabilities: { ...nullLexiconResolver.capabilities, search: canSearch },
      resolveSense,
      searchSenses,
    },
  ]);
  const handlers = { onLink: jest.fn(), onUnlink: jest.fn(), onAdopt: jest.fn() };
  const view = render(
    <TooltipProvider>
      <LexiconSensesProvider registry={registry}>
        <CatalogSenseControl
          analysisLanguage="en"
          form="agua"
          gloss=""
          localizedStrings={STRINGS}
          readOnly={false}
          {...handlers}
          {...props}
        />
      </LexiconSensesProvider>
    </TooltipProvider>,
  );
  return { ...view, ...handlers, searchSenses, resolveSense };
}

/** Opens the control's popover. */
async function openPopover() {
  await userEvent.click(await screen.findByTestId('catalog-sense-control'));
}

describe('CatalogSenseControl', () => {
  describe('what it renders', () => {
    it('renders nothing for an unlinked form that cannot be linked', () => {
      const { container } = renderControl({}, { canSearch: false });

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for an unlinked form with no text', () => {
      const { container } = renderControl({ form: '' });

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for an unlinked form in a read-only analysis', () => {
      const { container } = renderControl({ readOnly: true });

      expect(container).toBeEmptyDOMElement();
    });

    it('offers an unlinked form a button to link it', () => {
      renderControl();

      expect(screen.getByRole('button', { name: 'senseAddLink' })).toBeInTheDocument();
      expect(screen.getByTestId('book-open-icon')).toBeInTheDocument();
    });

    it('shows a read-only link as a mark that opens nothing', async () => {
      renderControl({ readOnly: true, gloss: 'water', senseRef: testSenseRef('s-1') });

      const mark = await screen.findByTestId('catalog-sense-link');
      expect(mark).toHaveAttribute('data-differs', 'false');
      expect(mark).toHaveTextContent('senseLinked');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.getByTestId('book-open-icon')).toBeInTheDocument();
    });

    it('marks a read-only link whose gloss comes from the sense, saying so', async () => {
      renderControl({ readOnly: true, senseRef: testSenseRef('s-1') });

      await screen.findByText(/senseGloss/);
      expect(screen.getByTestId('catalog-sense-link')).toHaveAttribute('data-from-lexicon', 'true');
    });

    it('flags a typed gloss that differs from the sense, naming the sense gloss', async () => {
      renderControl({ readOnly: true, gloss: 'liquid', senseRef: testSenseRef('s-1') });

      expect(await screen.findByText(/differs water/)).toBeInTheDocument();
      expect(screen.getByTestId('catalog-sense-link')).toHaveAttribute('data-differs', 'true');
      expect(screen.getByTestId('book-alert-icon')).toBeInTheDocument();
    });

    it('shows a link no connected lexicon answers for as a mark where none can search', async () => {
      renderControl({ senseRef: { authority: 'elsewhere', senseId: 's-1' } }, { canSearch: false });

      expect(await screen.findByTestId('catalog-sense-link')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows a linked sense with nothing to do as a mark', async () => {
      renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { canSearch: false, resolveSense: jest.fn().mockRejectedValue(new Error('down')) },
      );

      await settle();
      expect(screen.getByTestId('catalog-sense-link')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('labels a linked form’s button by the link', async () => {
      renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') });

      expect(await screen.findByRole('button', { name: 'senseLinked' })).toBeInTheDocument();
      expect(screen.getByTestId('book-open-icon')).toBeInTheDocument();
    });

    it('places the control where the caller says', async () => {
      renderControl({ className: 'extra', style: { gridRow: 3 } });

      const button = await screen.findByTestId('catalog-sense-control');
      expect(button).toHaveClass('extra');
      expect(button).toHaveStyle({ gridRow: '3' });
    });

    it('places a mark where the caller says', async () => {
      renderControl({
        className: 'extra',
        readOnly: true,
        senseRef: testSenseRef('s-1'),
        style: { gridRow: 3 },
      });

      const mark = await screen.findByTestId('catalog-sense-link');
      expect(mark).toHaveClass('extra');
      expect(mark).toHaveStyle({ gridRow: '3' });
    });
  });

  describe('the menu', () => {
    it('skips the menu for an unlinked form, opening the search with no way back', async () => {
      renderControl();
      await openPopover();

      expect(await screen.findByTestId('catalog-sense-candidate')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseBack' })).not.toBeInTheDocument();
    });

    it('offers a linked form a change of sense, and shows the sense’s gloss', async () => {
      renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') });
      await openPopover();

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
      expect(await screen.findByTestId('catalog-sense-menu-gloss')).toHaveTextContent(
        'lexicon says water',
      );
    });

    it('offers to unlink a link the lexicon answers for, and unlinks at once over a typed gloss', async () => {
      const { onUnlink } = renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') });
      await openPopover();

      await userEvent.click(await screen.findByRole('button', { name: 'senseUnlink' }));

      expect(onUnlink).toHaveBeenCalledTimes(1);
      expect(onUnlink).toHaveBeenCalledWith();
      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('offers no unlink and no adoption when the typed gloss matches the sense', async () => {
      renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') });
      await settle();
      await openPopover();

      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseAdoptGloss' })).not.toBeInTheDocument();
    });

    it('offers to adopt the sense gloss over a typed gloss that differs, and does so at once', async () => {
      const { onAdopt, onUnlink } = renderControl({
        gloss: 'liquid',
        senseRef: testSenseRef('s-1'),
      });
      await openPopover();

      await userEvent.click(await screen.findByRole('button', { name: 'senseAdoptGloss' }));

      expect(onAdopt).toHaveBeenCalledWith('water');
      expect(onUnlink).not.toHaveBeenCalled();
      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('offers to adopt a sense gloss where nothing is typed', async () => {
      renderControl({ senseRef: testSenseRef('s-1') });
      await openPopover();

      expect(await screen.findByRole('button', { name: 'senseAdoptGloss' })).toBeInTheDocument();
    });

    it('offers no adoption where the sense has no gloss in the language', async () => {
      renderControl({ gloss: 'liquid', senseRef: testSenseRef('s-fr') });
      await settle();
      await openPopover();

      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseAdoptGloss' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('catalog-sense-menu-gloss')).not.toBeInTheDocument();
    });

    it('offers to unlink a sense the lexicon no longer has', async () => {
      renderControl({ gloss: 'water', senseRef: testSenseRef('gone') });
      await openPopover();

      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
    });

    it('offers no unlink while the sense is being looked up', async () => {
      const pending = deferred<ResolvedSense | undefined>();
      renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { resolveSense: () => pending.promise },
      );
      await openPopover();

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseUnlink' })).not.toBeInTheDocument();
      await act(async () => pending.resolve(SENSES['s-1']));
      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
    });

    it('offers no unlink after the look-up failed', async () => {
      renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { resolveSense: jest.fn().mockRejectedValue(new Error('down')) },
      );
      await settle();
      await openPopover();

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseUnlink' })).not.toBeInTheDocument();
    });

    it('offers a link with no form to unlink and to adopt, but not to link or change', async () => {
      renderControl({ form: '', senseRef: testSenseRef('s-1') });
      await openPopover();

      expect(await screen.findByRole('button', { name: 'senseAdoptGloss' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseChangeAction' })).not.toBeInTheDocument();
    });

    it('offers a change of sense but no unlink for a link no connected lexicon answers for', async () => {
      renderControl({ senseRef: { authority: 'elsewhere', senseId: 's-1' } });
      await openPopover();

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseUnlink' })).not.toBeInTheDocument();
    });

    it('offers no change of sense where no lexicon can search', async () => {
      renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') }, { canSearch: false });
      await openPopover();

      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseChangeAction' })).not.toBeInTheDocument();
    });

    it('returns to the menu when the popover closes and opens again', async () => {
      renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') });
      await openPopover();
      await userEvent.click(await screen.findByRole('button', { name: 'senseChangeAction' }));
      await screen.findByTestId('catalog-sense-candidate');

      await userEvent.click(screen.getByTestId('catalog-sense-control'));
      await userEvent.click(screen.getByTestId('catalog-sense-control'));

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
    });
  });

  describe('linking', () => {
    it('searches for the form as it stands, once', async () => {
      const { searchSenses } = renderControl();
      await openPopover();

      await screen.findByTestId('catalog-sense-candidate');

      expect(searchSenses).toHaveBeenCalledTimes(1);
      expect(searchSenses).toHaveBeenCalledWith(FORM_QUERY);
    });

    it('shows a spinner while the search is out', async () => {
      const pending = deferred<SenseCandidate[]>();
      renderControl({}, { searchSenses: () => pending.promise });
      await openPopover();

      expect(await screen.findByTestId('spinner')).toBeInTheDocument();
      await act(async () => pending.resolve([]));
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });

    it('says so when nothing matches', async () => {
      renderControl({}, { searchSenses: async () => [] });
      await openPopover();

      expect(await screen.findByTestId('catalog-sense-no-match')).toHaveTextContent('senseNoMatch');
    });

    it('says so when the search fails', async () => {
      renderControl({}, { searchSenses: jest.fn().mockRejectedValue(new Error('down')) });
      await openPopover();

      expect(await screen.findByTestId('catalog-sense-search-failed')).toHaveTextContent(
        'senseSearchFailed',
      );
    });

    it('lists each candidate by its gloss in the analysis language, with what tells it apart', async () => {
      renderControl(
        {},
        {
          searchSenses: async () => [
            candidate('s-1', {
              gloss: { en: 'water', fr: 'eau' },
              lexemeForm: { grc: 'ὕδωρ' },
              senseLabel: '2',
              definition: { en: 'clear liquid' },
            }),
          ],
        },
      );
      await openPopover();

      const item = await screen.findByTestId('catalog-sense-candidate');
      expect(item).toHaveTextContent('water');
      expect(item).toHaveTextContent('ὕδωρ · 2 · clear liquid');
      expect(item).not.toHaveTextContent('eau');
    });

    it('lists a candidate with no gloss in the analysis language by another one', async () => {
      renderControl(
        {},
        { searchSenses: async () => [candidate('s-fr', { gloss: { fr: 'eau' } })] },
      );
      await openPopover();

      expect(await screen.findByTestId('catalog-sense-candidate')).toHaveTextContent('eau');
    });

    it('lists a candidate with no gloss at all as having none', async () => {
      renderControl({}, { searchSenses: async () => [candidate('s-x', { gloss: {} })] });
      await openPopover();

      const item = await screen.findByTestId('catalog-sense-candidate');
      expect(item).toHaveTextContent('noGloss');
      expect(item).not.toHaveTextContent('·');
    });

    it('marks the sense the form links to now, and no other', async () => {
      renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { searchSenses: async () => [candidate('s-1'), candidate('s-2')] },
      );
      await openPopover();

      await userEvent.click(await screen.findByRole('button', { name: 'senseChangeAction' }));

      const [current, other] = await screen.findAllByTestId('catalog-sense-candidate');
      expect(current).toHaveAttribute('aria-current', 'true');
      expect(current).toHaveTextContent('senseCurrent');
      expect(other).not.toHaveAttribute('aria-current');
      expect(other).not.toHaveTextContent('senseCurrent');
    });

    it('does not mark a sense of the same id in another lexicon project', async () => {
      renderControl(
        { senseRef: { ...testSenseRef('s-1'), projectId: 'p-1' } },
        { searchSenses: async () => [candidate('s-1')] },
      );
      await openPopover();

      await userEvent.click(await screen.findByRole('button', { name: 'senseChangeAction' }));

      expect(await screen.findByTestId('catalog-sense-candidate')).not.toHaveAttribute(
        'aria-current',
      );
    });

    it('links the picked candidate and closes', async () => {
      const picked = candidate('s-2');
      const { onLink } = renderControl(
        {},
        { searchSenses: async () => [candidate('s-1'), picked] },
      );
      await openPopover();

      const items = await screen.findAllByTestId('catalog-sense-candidate');
      await userEvent.click(items[1]);

      expect(onLink).toHaveBeenCalledTimes(1);
      expect(onLink).toHaveBeenCalledWith(picked);
      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('goes back to a linked form’s menu without linking', async () => {
      const { onLink } = renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') });
      await openPopover();
      await userEvent.click(await screen.findByRole('button', { name: 'senseChangeAction' }));
      await screen.findByTestId('catalog-sense-candidate');

      await userEvent.click(screen.getByRole('button', { name: 'senseBack' }));

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
      expect(onLink).not.toHaveBeenCalled();
    });

    it('ignores a search that answers after the popover closed', async () => {
      const first = deferred<SenseCandidate[]>();
      const second = deferred<SenseCandidate[]>();
      const searchSenses = jest
        .fn<Promise<SenseCandidate[]>, [SenseQuery]>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      renderControl({}, { searchSenses });
      await openPopover();
      await screen.findByTestId('spinner');
      await userEvent.click(screen.getByTestId('catalog-sense-control'));

      await openPopover();
      await screen.findByTestId('spinner');
      await act(async () => first.resolve([candidate('stale')]));

      expect(screen.getByTestId('spinner')).toBeInTheDocument();
      await act(async () => second.resolve([candidate('fresh')]));
      expect(await screen.findByTestId('catalog-sense-candidate')).toHaveTextContent('fresh');
      expect(screen.queryByText('stale')).not.toBeInTheDocument();
    });

    it('ignores a search that fails after the popover closed', async () => {
      const pending = deferred<SenseCandidate[]>();
      renderControl({}, { searchSenses: () => pending.promise });
      await openPopover();
      await screen.findByTestId('spinner');
      await userEvent.click(screen.getByTestId('catalog-sense-control'));

      await act(async () => pending.reject(new Error('down')));

      expect(screen.queryByTestId('catalog-sense-search-failed')).not.toBeInTheDocument();
    });
  });

  describe('changing the search', () => {
    /** Opens the dialog that changes the search, from an unlinked form's popover. */
    async function openDialog() {
      await userEvent.click(await screen.findByRole('button', { name: 'senseRefine' }));
      return screen.getByRole('dialog', { name: 'senseRefineTitle' });
    }

    /** Fills the dialog with `text`, searched in glosses, whole. */
    async function askForWholeGloss(dialog: HTMLElement, text: string) {
      const input = within(dialog).getByLabelText('senseRefineText');
      await userEvent.clear(input);
      await userEvent.type(input, text);
      await userEvent.click(within(dialog).getByLabelText('en gloss'));
      await userEvent.click(within(dialog).getByLabelText('senseRefineExact'));
    }

    it('says the popover searches forms containing the form it sits beside', async () => {
      renderControl();
      await openPopover();

      expect(await screen.findByTestId('catalog-sense-query')).toHaveTextContent(
        'form contains agua',
      );
    });

    it('opens a dialog on the search the popover shows, leaving the popover open', async () => {
      renderControl();
      await openPopover();

      const dialog = await openDialog();

      expect(within(dialog).getByLabelText('senseRefineText')).toHaveValue('agua');
      expect(within(dialog).getByLabelText('senseRefineForm')).toBeChecked();
      expect(within(dialog).getByLabelText('senseRefineExact')).not.toBeChecked();
      expect(screen.getByTestId('catalog-sense-popover')).toBeInTheDocument();
    });

    it('searches again with what the dialog asks for, and lists what it finds in the popover', async () => {
      const searchSenses = jest
        .fn<Promise<SenseCandidate[]>, [SenseQuery]>()
        .mockResolvedValueOnce([candidate('s-1')])
        .mockResolvedValueOnce([candidate('s-2')]);
      renderControl({}, { searchSenses });
      await openPopover();
      await screen.findByTestId('catalog-sense-candidate');
      const dialog = await openDialog();

      await askForWholeGloss(dialog, ' water ');
      await userEvent.click(within(dialog).getByRole('button', { name: 'senseRefineSubmit' }));

      expect(searchSenses).toHaveBeenLastCalledWith({
        text: 'water',
        field: 'gloss',
        exact: true,
        writingSystem: 'en',
      });
      expect(screen.queryByRole('dialog', { name: 'senseRefineTitle' })).not.toBeInTheDocument();
      expect(await screen.findByTestId('catalog-sense-candidate')).toHaveTextContent('s-2');
    });

    it('says what a changed search matches', async () => {
      renderControl();
      await openPopover();
      const dialog = await openDialog();

      await askForWholeGloss(dialog, 'water');
      await userEvent.click(within(dialog).getByRole('button', { name: 'senseRefineSubmit' }));

      await screen.findByTestId('catalog-sense-candidate');
      expect(screen.getByTestId('catalog-sense-query')).toHaveTextContent('en gloss is water');
    });

    it('searches forms in every writing system rather than in the analysis language', async () => {
      const { searchSenses } = renderControl();
      await openPopover();
      const dialog = await openDialog();

      await userEvent.type(within(dialog).getByLabelText('senseRefineText'), 's');
      await userEvent.click(within(dialog).getByRole('button', { name: 'senseRefineSubmit' }));

      await screen.findByTestId('catalog-sense-candidate');
      expect(jest.mocked(searchSenses).mock.lastCall?.[0]).toStrictEqual({
        ...FORM_QUERY,
        text: 'aguas',
      });
    });

    it('opens the dialog again on the search it last asked for', async () => {
      renderControl();
      await openPopover();
      const first = await openDialog();
      await askForWholeGloss(first, 'water');
      await userEvent.click(within(first).getByRole('button', { name: 'senseRefineSubmit' }));
      await screen.findByTestId('catalog-sense-candidate');

      const second = await openDialog();

      expect(within(second).getByLabelText('senseRefineText')).toHaveValue('water');
      expect(within(second).getByLabelText('en gloss')).toBeChecked();
      expect(within(second).getByLabelText('senseRefineExact')).toBeChecked();
    });

    it('goes back to searching forms when the dialog switches back to them', async () => {
      const { searchSenses } = renderControl();
      await openPopover();
      const first = await openDialog();
      await askForWholeGloss(first, 'water');
      await userEvent.click(within(first).getByRole('button', { name: 'senseRefineSubmit' }));
      await screen.findByTestId('catalog-sense-candidate');
      const second = await openDialog();

      await userEvent.click(within(second).getByLabelText('senseRefineForm'));
      await userEvent.click(within(second).getByRole('button', { name: 'senseRefineSubmit' }));

      await screen.findByTestId('catalog-sense-candidate');
      expect(jest.mocked(searchSenses).mock.lastCall?.[0]).toStrictEqual({
        text: 'water',
        field: 'form',
        exact: true,
      });
    });

    it('cannot search for blank text', async () => {
      renderControl();
      await openPopover();
      const dialog = await openDialog();

      await userEvent.clear(within(dialog).getByLabelText('senseRefineText'));
      await userEvent.type(within(dialog).getByLabelText('senseRefineText'), '  ');

      expect(within(dialog).getByRole('button', { name: 'senseRefineSubmit' })).toBeDisabled();
    });

    it('keeps the search and the popover when the dialog is canceled', async () => {
      const { searchSenses } = renderControl();
      await openPopover();
      await screen.findByTestId('catalog-sense-candidate');
      const dialog = await openDialog();

      await userEvent.type(within(dialog).getByLabelText('senseRefineText'), 's');
      await userEvent.click(within(dialog).getByRole('button', { name: 'senseCancel' }));

      expect(screen.queryByRole('dialog', { name: 'senseRefineTitle' })).not.toBeInTheDocument();
      expect(screen.getByTestId('catalog-sense-candidate')).toBeInTheDocument();
      expect(screen.getByTestId('catalog-sense-query')).toHaveTextContent('form contains agua');
      expect(searchSenses).toHaveBeenCalledTimes(1);
    });

    it('keeps the popover open while focus is in the dialog', async () => {
      renderControl();
      await openPopover();
      await openDialog();

      await userEvent.click(screen.getByTestId('popover-focus-outside'));

      expect(screen.getByTestId('catalog-sense-popover')).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'senseRefineTitle' })).toBeInTheDocument();
    });

    it('closes the popover when focus leaves it with no dialog open', async () => {
      renderControl();
      await openPopover();
      await screen.findByTestId('catalog-sense-candidate');

      await userEvent.click(screen.getByTestId('popover-focus-outside'));

      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('searches the form again once the popover closes and opens', async () => {
      const { searchSenses } = renderControl();
      await openPopover();
      const dialog = await openDialog();
      await askForWholeGloss(dialog, 'water');
      await userEvent.click(within(dialog).getByRole('button', { name: 'senseRefineSubmit' }));
      await screen.findByTestId('catalog-sense-candidate');

      await userEvent.click(screen.getByTestId('catalog-sense-control'));
      await openPopover();

      expect(await screen.findByTestId('catalog-sense-query')).toHaveTextContent(
        'form contains agua',
      );
      expect(searchSenses).toHaveBeenLastCalledWith(FORM_QUERY);
    });
  });

  describe('unlinking a gloss that comes from the sense', () => {
    /** Opens the confirmation over a link with nothing typed. */
    async function openConfirmation() {
      const handlers = renderControl({ senseRef: testSenseRef('s-1') });
      await openPopover();
      await userEvent.click(await screen.findByRole('button', { name: 'senseUnlink' }));
      return handlers;
    }

    it('asks whether to keep the gloss, naming it, before unlinking', async () => {
      const { onUnlink } = await openConfirmation();

      expect(screen.getByTestId('catalog-sense-keep-prompt')).toHaveTextContent('keep water?');
      expect(onUnlink).not.toHaveBeenCalled();
    });

    it('keeps the gloss as the typed gloss and closes', async () => {
      const { onUnlink } = await openConfirmation();

      await userEvent.click(screen.getByRole('button', { name: 'senseKeepGloss' }));

      expect(onUnlink).toHaveBeenCalledWith('water');
      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('removes the gloss with the link and closes', async () => {
      const { onUnlink } = await openConfirmation();

      await userEvent.click(screen.getByRole('button', { name: 'senseRemoveGloss' }));

      expect(onUnlink).toHaveBeenCalledTimes(1);
      expect(onUnlink).toHaveBeenCalledWith();
      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('goes back to the menu on cancel, unlinking nothing', async () => {
      const { onUnlink } = await openConfirmation();

      await userEvent.click(screen.getByRole('button', { name: 'senseCancel' }));

      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
      expect(onUnlink).not.toHaveBeenCalled();
    });
  });
});
