/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnalysisLanguageSelect from '../../../components/controls/AnalysisLanguageSelect';
import { mockKeyAsValueLocalizedStrings } from '../test-helpers';

beforeEach(() => {
  mockKeyAsValueLocalizedStrings();
});

describe('AnalysisLanguageSelect', () => {
  it('renders nothing for a single language', () => {
    const { container } = render(
      <AnalysisLanguageSelect languages={['en']} value="en" onValueChange={jest.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('labels the trigger as the analysis language', () => {
    render(
      <AnalysisLanguageSelect languages={['en', 'fr']} value="en" onValueChange={jest.fn()} />,
    );

    expect(screen.getByTestId('analysis-language-select')).toHaveAttribute(
      'aria-label',
      '%interlinearizer_analysisLanguage_label%',
    );
  });

  it('names each language beside its tag, in the given locales', () => {
    render(
      <AnalysisLanguageSelect
        languages={['swh', 'fr']}
        value="swh"
        onValueChange={jest.fn()}
        locales={['fr']}
      />,
    );

    expect(screen.getByTestId('analysis-language-swh')).toHaveTextContent('swahili (swh)');
    expect(screen.getByTestId('analysis-language-fr')).toHaveTextContent('français (fr)');
  });

  it('shows the bare tag when its name is only the tag again', () => {
    // A tag no language answers to is named as itself, which would otherwise read "english (English)".
    render(
      <AnalysisLanguageSelect languages={['en', 'English']} value="en" onValueChange={jest.fn()} />,
    );

    expect(screen.getByTestId('analysis-language-English')).toHaveTextContent(/^English$/);
  });

  it('marks the current language selected', () => {
    render(
      <AnalysisLanguageSelect languages={['en', 'fr']} value="fr" onValueChange={jest.fn()} />,
    );

    expect(screen.getByTestId('analysis-language-fr')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('analysis-language-en')).toHaveAttribute('aria-selected', 'false');
  });

  it('reports the picked language', async () => {
    const onValueChange = jest.fn();
    render(
      <AnalysisLanguageSelect languages={['en', 'fr']} value="en" onValueChange={onValueChange} />,
    );

    await userEvent.click(screen.getByTestId('analysis-language-fr'));

    expect(onValueChange).toHaveBeenCalledWith('fr');
  });
});
