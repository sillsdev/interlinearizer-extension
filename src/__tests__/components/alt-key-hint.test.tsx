/// <reference types="jest" />

import { render, screen } from '@testing-library/react';
import { altKeyHint } from '../../components/alt-key-hint';
import { pretendMacOs } from '../test-helpers';

const HINT = 'Join these two segments. Hold {key} and click between words to split.';

describe('altKeyHint', () => {
  it('names the Alt key off a Mac', () => {
    render(<p>{altKeyHint(HINT)}</p>);
    expect(screen.getByText('Alt')).toBeInTheDocument();
  });

  it('shows the Option glyph on a Mac', () => {
    pretendMacOs();
    render(<p>{altKeyHint(HINT)}</p>);
    expect(screen.getByText('⌥')).toBeInTheDocument();
  });

  it('spells out no key name alongside the glyph on a Mac', () => {
    pretendMacOs();
    render(<p data-testid="hint">{altKeyHint(HINT)}</p>);
    expect(screen.getByTestId('hint')).toHaveTextContent(
      'Join these two segments. Hold ⌥ and click between words to split.',
    );
  });

  it('sets the key name in a kbd element rather than in the running text', () => {
    render(<p>{altKeyHint(HINT)}</p>);
    expect(screen.getByText('Alt').tagName).toBe('KBD');
  });

  it('keeps the sentence around the key readable as one paragraph', () => {
    render(<p data-testid="hint">{altKeyHint(HINT)}</p>);
    expect(screen.getByTestId('hint')).toHaveTextContent(
      'Join these two segments. Hold Alt and click between words to split.',
    );
  });

  it('renders a hint still awaiting localization as its own bare text', () => {
    render(
      <p data-testid="hint">{altKeyHint('%interlinearizer_boundaryControl_mergeAltHint%')}</p>,
    );
    expect(screen.getByTestId('hint')).toHaveTextContent(
      '%interlinearizer_boundaryControl_mergeAltHint%',
    );
  });

  it('sets no key name into a hint still awaiting localization', () => {
    render(<p>{altKeyHint('%interlinearizer_boundaryControl_mergeAltHint%')}</p>);
    expect(screen.queryByText('Alt')).not.toBeInTheDocument();
  });
});
