/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SenseRef } from 'interlinearizer';
import type { ResolvedSense, SenseCandidate } from 'interlinearizer/lexicon';
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
};

const SENSES: Record<string, ResolvedSense> = {
  's-1': { gloss: { en: 'water' } },
  's-2': { gloss: { en: 'rain' } },
  's-fr': { gloss: { fr: 'eau' } },
};

/** A search hit for the sense `senseId`. */
function candidate(senseId: string, overrides: Partial<SenseCandidate> = {}): SenseCandidate {
  return {
    gloss: { en: senseId },
    entryRef: { authority: TEST_LEXICON_AUTHORITY, entryId: 'e-1' },
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
 * `lexicon` says otherwise, answers searches with `searchByForm`, and lists an entry's senses with
 * `listEntrySenses`.
 */
function renderControl(
  props: Partial<ComponentProps<typeof CatalogSenseControl>> = {},
  lexicon: {
    canSearch?: boolean;
    searchByForm?: (form: string) => Promise<SenseCandidate[]>;
    listEntrySenses?: (ref: SenseRef) => Promise<SenseCandidate[] | undefined>;
    resolveSense?: (ref: SenseRef) => Promise<ResolvedSense | undefined>;
  } = {},
) {
  const {
    canSearch = true,
    searchByForm = jest.fn(async () => [candidate('s-1')]),
    listEntrySenses = jest.fn(async () => [candidate('s-1')]),
    resolveSense = jest.fn(async ({ senseId }: SenseRef) => SENSES[senseId]),
  } = lexicon;
  const registry = createLexiconRegistry([
    {
      ...nullLexiconResolver,
      authorities: [TEST_LEXICON_AUTHORITY],
      capabilities: { ...nullLexiconResolver.capabilities, search: canSearch },
      resolveSense,
      searchByForm,
      listEntrySenses,
    },
  ]);
  const handlers = { onLink: jest.fn(), onUnlink: jest.fn(), onAdopt: jest.fn() };
  const tree = (overrides: Partial<ComponentProps<typeof CatalogSenseControl>>) => (
    <TooltipProvider>
      <LexiconSensesProvider registry={registry}>
        <CatalogSenseControl
          analysisLanguage="en"
          form="agua"
          gloss=""
          localizedStrings={STRINGS}
          readOnly={false}
          {...handlers}
          {...overrides}
        />
      </LexiconSensesProvider>
    </TooltipProvider>
  );
  const user = userEvent.setup();
  const view = render(tree(props));
  const rerenderWith = (next: Partial<ComponentProps<typeof CatalogSenseControl>>) =>
    view.rerender(tree({ ...props, ...next }));
  return { ...view, ...handlers, user, searchByForm, listEntrySenses, resolveSense, rerenderWith };
}

/** Opens the control's popover as `user`. */
async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('catalog-sense-control'));
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

    it('shows a link no connected lexicon answers for as a mark', async () => {
      renderControl({ senseRef: { authority: 'elsewhere', senseId: 's-1' } });

      expect(await screen.findByTestId('catalog-sense-link')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows a link whose look-up failed as a mark', async () => {
      renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { resolveSense: jest.fn().mockRejectedValue(new Error('down')) },
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
      const { user } = renderControl();
      await openPopover(user);

      expect(await screen.findByTestId('catalog-sense-candidate')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseBack' })).not.toBeInTheDocument();
    });

    it('offers a linked form a change of sense, and shows the sense’s gloss', async () => {
      const { user } = renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') });
      await openPopover(user);

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
      expect(await screen.findByTestId('catalog-sense-menu-gloss')).toHaveTextContent(
        'lexicon says water',
      );
    });

    it('offers to unlink a link the lexicon answers for, and unlinks at once over a typed gloss', async () => {
      const { onUnlink, user } = renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') });
      await openPopover(user);

      await user.click(await screen.findByRole('button', { name: 'senseUnlink' }));

      expect(onUnlink).toHaveBeenCalledTimes(1);
      expect(onUnlink).toHaveBeenCalledWith();
      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('offers no unlink and no adoption when the typed gloss matches the sense', async () => {
      const { user } = renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') });
      await settle();
      await openPopover(user);

      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseAdoptGloss' })).not.toBeInTheDocument();
    });

    it('offers to adopt the sense gloss over a typed gloss that differs, and does so at once', async () => {
      const { onAdopt, onUnlink, user } = renderControl({
        gloss: 'liquid',
        senseRef: testSenseRef('s-1'),
      });
      await openPopover(user);

      await user.click(await screen.findByRole('button', { name: 'senseAdoptGloss' }));

      expect(onAdopt).toHaveBeenCalledWith('water');
      expect(onUnlink).not.toHaveBeenCalled();
      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('offers to adopt a sense gloss where nothing is typed', async () => {
      const { user } = renderControl({ senseRef: testSenseRef('s-1') });
      await openPopover(user);

      expect(await screen.findByRole('button', { name: 'senseAdoptGloss' })).toBeInTheDocument();
    });

    it('offers no adoption where the sense has no gloss in the language', async () => {
      const { user } = renderControl({ gloss: 'liquid', senseRef: testSenseRef('s-fr') });
      await settle();
      await openPopover(user);

      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseAdoptGloss' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('catalog-sense-menu-gloss')).not.toBeInTheDocument();
    });

    it('offers to unlink a sense the lexicon no longer has', async () => {
      const { user } = renderControl({ gloss: 'water', senseRef: testSenseRef('gone') });
      await openPopover(user);

      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
    });

    it('shows a mark while the sense is being looked up, and offers its actions once it arrives', async () => {
      const pending = deferred<ResolvedSense | undefined>();
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { resolveSense: () => pending.promise },
      );

      expect(screen.getByTestId('catalog-sense-link')).toBeInTheDocument();
      await act(async () => pending.resolve(SENSES['s-1']));
      await openPopover(user);
      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
    });

    it('offers a link with no form a change of sense', async () => {
      const { user } = renderControl({ form: '', senseRef: testSenseRef('s-1') });
      await openPopover(user);

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseLinkAction' })).not.toBeInTheDocument();
    });

    it('offers a change of sense where no lexicon can search', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { canSearch: false },
      );
      await openPopover(user);

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
    });

    it('offers no change of sense for a sense the lexicon no longer has', async () => {
      const { user } = renderControl({ gloss: 'water', senseRef: testSenseRef('gone') });
      await openPopover(user);

      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'senseChangeAction' })).not.toBeInTheDocument();
    });

    it('disables the change of sense, saying why, when the entry has no other sense', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { listEntrySenses: async () => [candidate('s-1')] },
      );
      await openPopover(user);
      await settle();

      expect(screen.getByRole('button', { name: 'senseChangeAction' })).toBeDisabled();
      expect(screen.getByRole('group', { name: 'senseNoOther' })).toBeInTheDocument();
    });

    it('disables the change of sense when the lexicon lists no entry for the sense', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { listEntrySenses: async () => undefined },
      );
      await openPopover(user);
      await settle();

      expect(screen.getByRole('button', { name: 'senseChangeAction' })).toBeDisabled();
    });

    it('focuses the menu rather than its first action on opening', async () => {
      const { user } = renderControl({ gloss: 'water', senseRef: testSenseRef('s-1') });
      await openPopover(user);
      await settle();

      expect(screen.getByTestId('catalog-sense-menu')).toHaveFocus();
    });

    it('offers the change of sense when the entry has another sense', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { listEntrySenses: async () => [candidate('s-1'), candidate('s-2')] },
      );
      await openPopover(user);
      await settle();

      expect(screen.getByRole('button', { name: 'senseChangeAction' })).toBeEnabled();
      expect(screen.queryByRole('group', { name: 'senseNoOther' })).not.toBeInTheDocument();
    });

    it('offers the change of sense while the entry’s senses are being listed', async () => {
      const pending = deferred<SenseCandidate[]>();
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { listEntrySenses: () => pending.promise },
      );
      await openPopover(user);

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeEnabled();
      await act(async () => pending.resolve([]));
    });

    it('lists the linked sense’s entry once, as the menu opens, rather than searching by form', async () => {
      const { listEntrySenses, searchByForm, user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { listEntrySenses: jest.fn(async () => [candidate('s-1'), candidate('s-2')]) },
      );
      await openPopover(user);
      await settle();

      await user.click(screen.getByRole('button', { name: 'senseChangeAction' }));

      expect(screen.getAllByTestId('catalog-sense-candidate')).toHaveLength(2);
      expect(listEntrySenses).toHaveBeenCalledTimes(1);
      expect(listEntrySenses).toHaveBeenCalledWith(testSenseRef('s-1'));
      expect(searchByForm).not.toHaveBeenCalled();
    });

    it('says so when the entry’s senses cannot be listed', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { listEntrySenses: jest.fn().mockRejectedValue(new Error('down')) },
      );
      await openPopover(user);
      await settle();

      await user.click(screen.getByRole('button', { name: 'senseChangeAction' }));

      expect(await screen.findByTestId('catalog-sense-search-failed')).toBeInTheDocument();
    });

    it('returns to the menu when the popover closes and opens again', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { listEntrySenses: async () => [candidate('s-1'), candidate('s-2')] },
      );
      await openPopover(user);
      await user.click(await screen.findByRole('button', { name: 'senseChangeAction' }));
      await screen.findAllByTestId('catalog-sense-candidate');

      await user.click(screen.getByTestId('catalog-sense-control'));
      await user.click(screen.getByTestId('catalog-sense-control'));

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
    });
  });

  describe('linking a linked form to another entry', () => {
    /** A sense of an entry other than the linked sense's. */
    const elsewhere = candidate('s-9', {
      entryRef: { authority: TEST_LEXICON_AUTHORITY, entryId: 'e-9' },
    });

    it('searches by form only once the action is chosen', async () => {
      const { searchByForm, user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { searchByForm: jest.fn(async () => [elsewhere]) },
      );
      await openPopover(user);
      await settle();
      expect(searchByForm).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'senseOtherEntryAction' }));

      expect(await screen.findByTestId('catalog-sense-candidate')).toHaveTextContent('s-9');
      expect(searchByForm).toHaveBeenCalledWith('agua');
    });

    it('links the picked sense in place of the old one, without unlinking', async () => {
      const { onLink, onUnlink, user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { searchByForm: async () => [elsewhere] },
      );
      await openPopover(user);
      await user.click(await screen.findByRole('button', { name: 'senseOtherEntryAction' }));

      await user.click(await screen.findByTestId('catalog-sense-candidate'));

      expect(onLink).toHaveBeenCalledTimes(1);
      expect(onLink).toHaveBeenCalledWith(elsewhere);
      expect(onUnlink).not.toHaveBeenCalled();
    });

    it('leaves out the senses of the linked sense’s entry', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { searchByForm: async () => [candidate('s-2'), elsewhere] },
      );
      await openPopover(user);
      await user.click(await screen.findByRole('button', { name: 'senseOtherEntryAction' }));

      const candidates = await screen.findAllByTestId('catalog-sense-candidate');

      expect(candidates.map((button) => button.textContent)).toEqual(['s-9']);
    });

    it('says nothing matches when only the linked sense’s entry does', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { searchByForm: async () => [candidate('s-1'), candidate('s-2')] },
      );
      await openPopover(user);
      await user.click(await screen.findByRole('button', { name: 'senseOtherEntryAction' }));

      expect(await screen.findByTestId('catalog-sense-no-match')).toBeInTheDocument();
      expect(screen.queryByTestId('catalog-sense-candidate')).not.toBeInTheDocument();
    });

    it('finds the linked sense’s entry in the search when its senses cannot be listed', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        {
          listEntrySenses: jest.fn().mockRejectedValue(new Error('down')),
          searchByForm: async () => [candidate('s-1'), elsewhere],
        },
      );
      await openPopover(user);
      await user.click(await screen.findByRole('button', { name: 'senseOtherEntryAction' }));

      const candidates = await screen.findAllByTestId('catalog-sense-candidate');

      expect(candidates.map((button) => button.textContent)).toEqual(['s-9']);
    });

    it('searches again each time the list is opened', async () => {
      const searchByForm = jest
        .fn<Promise<SenseCandidate[]>, [string]>()
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValue([elsewhere]);
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { searchByForm },
      );
      await openPopover(user);
      await user.click(await screen.findByRole('button', { name: 'senseOtherEntryAction' }));
      await screen.findByTestId('catalog-sense-search-failed');

      await user.click(screen.getByRole('button', { name: 'senseBack' }));
      await user.click(screen.getByRole('button', { name: 'senseOtherEntryAction' }));

      expect(await screen.findByTestId('catalog-sense-candidate')).toHaveTextContent('s-9');
      expect(searchByForm).toHaveBeenCalledTimes(2);
    });

    it('is not offered when the lexicon cannot search', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { canSearch: false },
      );
      await openPopover(user);

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'senseOtherEntryAction' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('linking', () => {
    it('searches for the form as it stands, once', async () => {
      const { searchByForm, user } = renderControl();
      await openPopover(user);

      await screen.findByTestId('catalog-sense-candidate');

      expect(searchByForm).toHaveBeenCalledTimes(1);
      expect(searchByForm).toHaveBeenCalledWith('agua');
    });

    it('shows a spinner while the search is out', async () => {
      const pending = deferred<SenseCandidate[]>();
      const { user } = renderControl({}, { searchByForm: () => pending.promise });
      await openPopover(user);

      expect(await screen.findByTestId('spinner')).toBeInTheDocument();
      await act(async () => pending.resolve([]));
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });

    it('says so when nothing matches', async () => {
      const { user } = renderControl({}, { searchByForm: async () => [] });
      await openPopover(user);

      expect(await screen.findByTestId('catalog-sense-no-match')).toHaveTextContent('senseNoMatch');
    });

    it('says so when the search fails', async () => {
      const { user } = renderControl(
        {},
        { searchByForm: jest.fn().mockRejectedValue(new Error('down')) },
      );
      await openPopover(user);

      expect(await screen.findByTestId('catalog-sense-search-failed')).toHaveTextContent(
        'senseSearchFailed',
      );
    });

    it('searches again when the action is chosen again after a failed search', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        {
          listEntrySenses: jest
            .fn()
            .mockRejectedValueOnce(new Error('down'))
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValue([candidate('s-1')]),
        },
      );
      await openPopover(user);
      await user.click(await screen.findByRole('button', { name: 'senseChangeAction' }));
      await screen.findByTestId('catalog-sense-search-failed');

      await user.click(screen.getByRole('button', { name: 'senseBack' }));
      await user.click(screen.getByRole('button', { name: 'senseChangeAction' }));

      expect(await screen.findByTestId('catalog-sense-candidate')).toBeInTheDocument();
    });

    it('drops the old candidates while the search for a changed form is out', async () => {
      const second = deferred<SenseCandidate[]>();
      const { rerenderWith, searchByForm, user } = renderControl(
        {},
        {
          searchByForm: jest
            .fn()
            .mockResolvedValueOnce([candidate('s-1')])
            .mockReturnValue(second.promise),
        },
      );
      await openPopover(user);
      await screen.findByTestId('catalog-sense-candidate');

      rerenderWith({ form: 'agu' });

      expect(screen.queryByTestId('catalog-sense-candidate')).not.toBeInTheDocument();
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
      expect(searchByForm).toHaveBeenLastCalledWith('agu');
      await act(async () => second.resolve([]));
    });

    it('shows the answer to the search for a changed form', async () => {
      const { rerenderWith, user } = renderControl(
        {},
        {
          searchByForm: jest
            .fn()
            .mockResolvedValueOnce([candidate('s-1')])
            .mockResolvedValue([]),
        },
      );
      await openPopover(user);
      await screen.findByTestId('catalog-sense-candidate');

      rerenderWith({ form: 'agu' });

      expect(await screen.findByTestId('catalog-sense-no-match')).toBeInTheDocument();
    });

    it('lists each candidate by its gloss in the analysis language, with what tells it apart', async () => {
      const { user } = renderControl(
        {},
        {
          searchByForm: async () => [
            candidate('s-1', {
              gloss: { en: 'water', fr: 'eau' },
              lexemeForm: { grc: 'ὕδωρ' },
              senseLabel: '2',
              definition: { en: 'clear liquid' },
            }),
          ],
        },
      );
      await openPopover(user);

      const item = await screen.findByTestId('catalog-sense-candidate');
      expect(item).toHaveTextContent('water');
      expect(item).toHaveTextContent('ὕδωρ · 2 · clear liquid');
      expect(item).not.toHaveTextContent('eau');
    });

    it('lists a candidate with no gloss in the analysis language by another one', async () => {
      const { user } = renderControl(
        {},
        { searchByForm: async () => [candidate('s-fr', { gloss: { fr: 'eau' } })] },
      );
      await openPopover(user);

      expect(await screen.findByTestId('catalog-sense-candidate')).toHaveTextContent('eau');
    });

    it('lists a candidate with no gloss at all as having none', async () => {
      const { user } = renderControl(
        {},
        { searchByForm: async () => [candidate('s-x', { gloss: {} })] },
      );
      await openPopover(user);

      const item = await screen.findByTestId('catalog-sense-candidate');
      expect(item).toHaveTextContent('noGloss');
      expect(item).not.toHaveTextContent('·');
    });

    it('marks the sense the form links to now, and no other', async () => {
      const { user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { listEntrySenses: async () => [candidate('s-1'), candidate('s-2')] },
      );
      await openPopover(user);

      await user.click(await screen.findByRole('button', { name: 'senseChangeAction' }));

      const [current, other] = await screen.findAllByTestId('catalog-sense-candidate');
      expect(current).toHaveAttribute('aria-current', 'true');
      expect(current).toHaveTextContent('senseCurrent');
      expect(other).not.toHaveAttribute('aria-current');
      expect(other).not.toHaveTextContent('senseCurrent');
    });

    it('does not mark a sense of the same id in another lexicon project', async () => {
      const { user } = renderControl(
        { senseRef: { ...testSenseRef('s-1'), projectId: 'p-1' } },
        { listEntrySenses: async () => [candidate('s-1')] },
      );
      await openPopover(user);

      await user.click(await screen.findByRole('button', { name: 'senseChangeAction' }));

      expect(await screen.findByTestId('catalog-sense-candidate')).not.toHaveAttribute(
        'aria-current',
      );
    });

    it('links the picked candidate and closes', async () => {
      const picked = candidate('s-2');
      const { onLink, user } = renderControl(
        {},
        { searchByForm: async () => [candidate('s-1'), picked] },
      );
      await openPopover(user);

      const items = await screen.findAllByTestId('catalog-sense-candidate');
      await user.click(items[1]);

      expect(onLink).toHaveBeenCalledTimes(1);
      expect(onLink).toHaveBeenCalledWith(picked);
      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('goes back to a linked form’s menu without linking', async () => {
      const { onLink, user } = renderControl(
        { gloss: 'water', senseRef: testSenseRef('s-1') },
        { listEntrySenses: async () => [candidate('s-1'), candidate('s-2')] },
      );
      await openPopover(user);
      await user.click(await screen.findByRole('button', { name: 'senseChangeAction' }));
      await screen.findAllByTestId('catalog-sense-candidate');

      await user.click(screen.getByRole('button', { name: 'senseBack' }));

      expect(await screen.findByRole('button', { name: 'senseChangeAction' })).toBeInTheDocument();
      expect(onLink).not.toHaveBeenCalled();
    });

    it('ignores a search that answers after the popover closed', async () => {
      const first = deferred<SenseCandidate[]>();
      const second = deferred<SenseCandidate[]>();
      const searchByForm = jest
        .fn<Promise<SenseCandidate[]>, [string]>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const { user } = renderControl({}, { searchByForm });
      await openPopover(user);
      await screen.findByTestId('spinner');
      await user.click(screen.getByTestId('catalog-sense-control'));

      await openPopover(user);
      await screen.findByTestId('spinner');
      await act(async () => first.resolve([candidate('stale')]));

      expect(screen.getByTestId('spinner')).toBeInTheDocument();
      await act(async () => second.resolve([candidate('fresh')]));
      expect(await screen.findByTestId('catalog-sense-candidate')).toHaveTextContent('fresh');
      expect(screen.queryByText('stale')).not.toBeInTheDocument();
    });

    it('ignores a search that fails after the popover closed', async () => {
      const pending = deferred<SenseCandidate[]>();
      const { user } = renderControl({}, { searchByForm: () => pending.promise });
      await openPopover(user);
      await screen.findByTestId('spinner');
      await user.click(screen.getByTestId('catalog-sense-control'));

      await act(async () => pending.reject(new Error('down')));

      expect(screen.queryByTestId('catalog-sense-search-failed')).not.toBeInTheDocument();
    });
  });

  describe('unlinking a gloss that comes from the sense', () => {
    /** Opens the confirmation over a link with nothing typed. */
    async function openConfirmation() {
      const handlers = renderControl({ senseRef: testSenseRef('s-1') });
      await openPopover(handlers.user);
      await handlers.user.click(await screen.findByRole('button', { name: 'senseUnlink' }));
      return handlers;
    }

    it('asks whether to keep the gloss, naming it, before unlinking', async () => {
      const { onUnlink } = await openConfirmation();

      expect(screen.getByTestId('catalog-sense-keep-prompt')).toHaveTextContent('keep water?');
      expect(onUnlink).not.toHaveBeenCalled();
    });

    it('keeps the gloss as the typed gloss and closes', async () => {
      const { onUnlink, user } = await openConfirmation();

      await user.click(screen.getByRole('button', { name: 'senseKeepGloss' }));

      expect(onUnlink).toHaveBeenCalledWith('water');
      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('removes the gloss with the link and closes', async () => {
      const { onUnlink, user } = await openConfirmation();

      await user.click(screen.getByRole('button', { name: 'senseRemoveGloss' }));

      expect(onUnlink).toHaveBeenCalledTimes(1);
      expect(onUnlink).toHaveBeenCalledWith();
      expect(screen.queryByTestId('catalog-sense-popover')).not.toBeInTheDocument();
    });

    it('goes back to the menu on cancel, unlinking nothing', async () => {
      const { onUnlink, user } = await openConfirmation();

      await user.click(screen.getByRole('button', { name: 'senseCancel' }));

      expect(await screen.findByRole('button', { name: 'senseUnlink' })).toBeInTheDocument();
      expect(onUnlink).not.toHaveBeenCalled();
    });
  });
});
