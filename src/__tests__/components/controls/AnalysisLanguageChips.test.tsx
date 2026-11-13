/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnalysisLanguageChips from '../../../components/controls/AnalysisLanguageChips';
import type { TextCountsByTag } from '../../../utils/text-counts';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_languageChips_menu%': '{tag} options',
  '%interlinearizer_languageChips_menu_primary%': '{tag} (primary) options',
  '%interlinearizer_languageChips_change%': 'Change code…',
  '%interlinearizer_languageChips_makePrimary%': 'Make primary',
  '%interlinearizer_languageChips_remove%': 'Remove',
  '%interlinearizer_languageChips_add%': 'Add',
  '%interlinearizer_languagePicker_addTitle%': 'Add analysis language',
  '%interlinearizer_languagePicker_changeTitle%': 'Change {tag}',
  '%interlinearizer_languagePicker_codeLabel%': 'Language code',
  '%interlinearizer_languagePicker_placeholder%': 'e.g. en',
  '%interlinearizer_languagePicker_invalid%': "{tag} isn't a valid language code.",
  '%interlinearizer_languagePicker_listed%': '{tag} is already an analysis language.',
  '%interlinearizer_languagePicker_hiddenHeading%': 'Hidden text',
  '%interlinearizer_languagePicker_hiddenItem%': '{tag}: {counts}',
  '%interlinearizer_languagePicker_add%': 'Add code',
  '%interlinearizer_languagePicker_change%': 'Change code',
  '%interlinearizer_languagePicker_cancel%': 'Cancel',
  '%interlinearizer_languageText_glosses%': '{glosses} glosses',
  '%interlinearizer_languageText_freeTranslations%': '{freeTranslations} free translations',
  '%interlinearizer_languageText_both%':
    '{glosses} glosses and {freeTranslations} free translations',
  '%interlinearizer_confirm_changeLanguage_title%': 'Change {from} to {to}?',
  '%interlinearizer_confirm_changeLanguage_existing%': '{to} already has {counts}.',
  '%interlinearizer_confirm_changeLanguage_body%': '{from} moves to {to}.',
  '%interlinearizer_confirm_changeLanguage_ok%': 'Change',
  '%interlinearizer_confirm_changeLanguage_cancel%': 'Cancel',
  '%interlinearizer_confirm_removeLanguage_title%': 'Remove {tag}?',
  '%interlinearizer_confirm_removeLanguage_existing%': '{tag} has {counts}.',
  '%interlinearizer_confirm_removeLanguage_body%': 'Keep them hidden or delete them.',
  '%interlinearizer_confirm_removeLanguage_keep%': 'Keep hidden',
  '%interlinearizer_confirm_removeLanguage_delete%': 'Delete',
  '%interlinearizer_confirm_removeLanguage_cancel%': 'Cancel',
};

/** Renders an editable row of `languages`, returning the change handler. */
function renderChips(languages: string[], textCounts: TextCountsByTag = {}) {
  const onChange = jest.fn(async () => {});
  render(
    <>
      <span id="label">Analysis languages</span>
      <AnalysisLanguageChips
        languages={languages}
        labelledBy="label"
        textCounts={textCounts}
        onChange={onChange}
      />
    </>,
  );
  return onChange;
}

/** Chooses `item` from the menu of the chip named `chip`. */
async function choose(chip: string, item: string) {
  await userEvent.click(screen.getByRole('button', { name: chip }));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

/** Types `code` into the open picker and submits it with the picker's button named `submit`. */
async function pick(code: string, submit: string) {
  await userEvent.type(screen.getByLabelText('Language code'), code);
  await userEvent.click(screen.getByRole('button', { name: submit }));
}

describe('AnalysisLanguageChips', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('shows the codes alone, primary first, with no actions when they cannot change', () => {
    render(
      <>
        <span id="label">Analysis languages</span>
        <AnalysisLanguageChips languages={['en', 'fr']} labelledBy="label" />
      </>,
    );

    const list = screen.getByRole('list', { name: 'Analysis languages' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['en', 'fr']);
    expect(within(items[0]).getByTestId('star-icon')).toBeInTheDocument();
    expect(within(items[1]).queryByTestId('star-icon')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('makes a code primary', async () => {
    const onChange = renderChips(['en', 'fr', 'de']);

    await choose('de options', 'Make primary');

    expect(onChange).toHaveBeenCalledWith({ analysisLanguages: ['de', 'en', 'fr'] });
  });

  it('offers no Make primary on the primary code', async () => {
    renderChips(['en', 'fr']);

    await userEvent.click(screen.getByRole('button', { name: 'en (primary) options' }));

    expect(screen.queryByRole('menuitem', { name: 'Make primary' })).not.toBeInTheDocument();
  });

  it('removes a code that has no text without asking', async () => {
    const onChange = renderChips(['en', 'fr'], { en: { glosses: 3, freeTranslations: 0 } });

    await choose('fr options', 'Remove');

    expect(onChange).toHaveBeenCalledWith({ analysisLanguages: ['en'] });
    expect(screen.queryByRole('heading', { name: 'Remove fr?' })).not.toBeInTheDocument();
  });

  it('makes the next code primary when the primary is removed', async () => {
    const onChange = renderChips(['en', 'fr', 'de']);

    await choose('en (primary) options', 'Remove');

    expect(onChange).toHaveBeenCalledWith({ analysisLanguages: ['fr', 'de'] });
  });

  it("won't remove the last code", async () => {
    renderChips(['en']);

    await userEvent.click(screen.getByRole('button', { name: 'en (primary) options' }));

    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeDisabled();
  });

  describe('removing a code that has text', () => {
    const counts = { fr: { glosses: 4, freeTranslations: 2 } };

    it('says how much text it has', async () => {
      renderChips(['en', 'fr'], counts);

      await choose('fr options', 'Remove');

      expect(screen.getByRole('heading', { name: 'Remove fr?' })).toBeInTheDocument();
      expect(screen.getByText('fr has 4 glosses and 2 free translations.')).toBeInTheDocument();
    });

    it('keeps the text hidden when the user says so', async () => {
      const onChange = renderChips(['en', 'fr'], counts);

      await choose('fr options', 'Remove');
      await userEvent.click(screen.getByRole('button', { name: 'Keep hidden' }));

      expect(onChange).toHaveBeenCalledWith({ analysisLanguages: ['en'] });
    });

    it('deletes the text when the user says so', async () => {
      const onChange = renderChips(['en', 'fr'], counts);

      await choose('fr options', 'Remove');
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(onChange).toHaveBeenCalledWith({ analysisLanguages: ['en'], deleteTextOf: 'fr' });
    });

    it('keeps the code when the user cancels', async () => {
      const onChange = renderChips(['en', 'fr'], counts);

      await choose('fr options', 'Remove');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: 'Remove fr?' })).not.toBeInTheDocument();
    });
  });

  describe('adding a code', () => {
    it('adds a code as the last one', async () => {
      const onChange = renderChips(['en']);

      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      await pick('tpi', 'Add code');

      expect(onChange).toHaveBeenCalledWith({ analysisLanguages: ['en', 'tpi'] });
      expect(
        screen.queryByRole('heading', { name: 'Add analysis language' }),
      ).not.toBeInTheDocument();
    });

    it('refuses a code already listed', async () => {
      renderChips(['en', 'fr']);

      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      await userEvent.type(screen.getByLabelText('Language code'), 'FR');

      expect(screen.getByText('fr is already an analysis language.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add code' })).toBeDisabled();
    });

    it('refuses a code that is not well formed', async () => {
      renderChips(['en']);

      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      await userEvent.type(screen.getByLabelText('Language code'), 'not a code');

      expect(screen.getByText("not a code isn't a valid language code.")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add code' })).toBeDisabled();
    });

    it('offers the codes whose text is hidden, with their counts', async () => {
      const onChange = renderChips(['en'], {
        en: { glosses: 1, freeTranslations: 0 },
        de: { glosses: 0, freeTranslations: 3 },
      });

      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      const hidden = screen.getByRole('list', { name: 'Hidden text' });
      expect(
        within(hidden)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['de: 3 free translations']);
      await userEvent.click(within(hidden).getByRole('button'));
      await userEvent.click(screen.getByRole('button', { name: 'Add code' }));

      expect(onChange).toHaveBeenCalledWith({ analysisLanguages: ['en', 'de'] });
    });

    it('adds nothing when the user cancels', async () => {
      const onChange = renderChips(['en']);

      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('changing a code', () => {
    it('moves its text to a code that has none without asking', async () => {
      const onChange = renderChips(['en', 'fr'], { fr: { glosses: 2, freeTranslations: 0 } });

      await choose('fr options', 'Change code…');
      expect(screen.getByRole('heading', { name: 'Change fr' })).toBeInTheDocument();
      await pick('es', 'Change code');

      expect(onChange).toHaveBeenCalledWith({
        analysisLanguages: ['en', 'es'],
        retag: { from: 'fr', to: 'es' },
      });
    });

    it("won't change a code to itself", async () => {
      renderChips(['en', 'fr']);

      await choose('fr options', 'Change code…');
      await userEvent.type(screen.getByLabelText('Language code'), 'fr');

      expect(screen.getByRole('button', { name: 'Change code' })).toBeDisabled();
    });

    it('asks before merging into a code that has text, and merges once confirmed', async () => {
      const onChange = renderChips(['en', 'fr'], {
        de: { glosses: 5, freeTranslations: 0 },
      });

      await choose('fr options', 'Change code…');
      await pick('de', 'Change code');

      expect(screen.getByRole('heading', { name: 'Change fr to de?' })).toBeInTheDocument();
      expect(screen.getByText('de already has 5 glosses.')).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Change' }));

      expect(onChange).toHaveBeenCalledWith({
        analysisLanguages: ['en', 'de'],
        retag: { from: 'fr', to: 'de' },
      });
    });

    it('leaves the code as it is when the user cancels the merge', async () => {
      const onChange = renderChips(['en', 'fr'], { de: { glosses: 5, freeTranslations: 0 } });

      await choose('fr options', 'Change code…');
      await pick('de', 'Change code');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onChange).not.toHaveBeenCalled();
    });

    it('merges into a listed code, which keeps the earlier place', async () => {
      const onChange = renderChips(['en', 'fr', 'de'], {
        en: { glosses: 1, freeTranslations: 0 },
      });

      await choose('de options', 'Change code…');
      await pick('en', 'Change code');
      await userEvent.click(screen.getByRole('button', { name: 'Change' }));

      expect(onChange).toHaveBeenCalledWith({
        analysisLanguages: ['en', 'fr'],
        retag: { from: 'de', to: 'en' },
      });
    });
  });

  it('holds every action while a change is being applied', async () => {
    let finish: () => void = () => {};
    const onChange = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <AnalysisLanguageChips languages={['en', 'fr']} labelledBy="label" onChange={onChange} />,
    );

    await choose('fr options', 'Make primary');

    expect(screen.getByRole('button', { name: 'en (primary) options' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    await act(async () => finish());

    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });
});
