/** @file Unit tests for components/TokenChip.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentStatus, Token, TokenSnapshot } from 'interlinearizer';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { InertTokenChip, TokenChip } from '../../components/TokenChip';

jest.mock('../../components/AnalysisStore');

const WORD_TOKEN = {
  ref: 'GEN 1:1:0',
  surfaceText: 'hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
} satisfies Token;

/**
 * Minimal required props for {@link TokenChip}. Spread into render calls so tests only need to
 * override what they actually care about.
 *
 * @returns An object with all required props set to no-op stubs.
 */
function requiredProps(): { token: Token & { type: 'word' }; onFocus: () => void } {
  return {
    token: WORD_TOKEN,
    onFocus: jest.fn(),
  };
}

const PUNCT_TOKEN = {
  ref: 'GEN 1:1:p',
  surfaceText: '.',
  writingSystem: 'en',
  type: 'punctuation',
  charStart: 5,
  charEnd: 6,
} satisfies Token;

describe('InertTokenChip', () => {
  it('renders the surface text', () => {
    render(<InertTokenChip token={PUNCT_TOKEN} />);
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders as an inline span', () => {
    render(<InertTokenChip token={PUNCT_TOKEN} />);
    expect(screen.getByText('.').tagName).toBe('SPAN');
  });
});

describe('TokenChip', () => {
  it('renders the surface text', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('applies a border class to the outer container', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    const outer = screen.getByText('hello').closest('span')?.parentElement;
    expect(outer?.className).toContain('tw:border');
  });

  it('applies a destructive border when isSplitFree is true', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} isSplitFree />
      </AnalysisStoreProvider>,
    );
    const label = screen.getByText('hello').closest('label');
    expect(label?.className).toContain('tw:border-destructive');
  });

  it('does not apply a destructive border when isSplitFree is false', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} isSplitFree={false} />
      </AnalysisStoreProvider>,
    );
    const label = screen.getByText('hello').closest('label');
    expect(label?.className).not.toContain('tw:border-destructive');
    expect(label?.className).toContain('tw:border-border');
  });

  it('renders a gloss input', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toBeInTheDocument();
  });

  it('shows the current gloss value from the store', () => {
    const initialAnalysis = {
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'hello', gloss: { und: 'in' } }],
      tokenAnalysisLinks: [
        {
          analysisId: 'ta-1',
          status: 'approved',
          token: { tokenRef: 'GEN 1:1:0', surfaceText: 'hello' },
        } satisfies {
          analysisId: string;
          status: AssignmentStatus;
          token: TokenSnapshot;
        },
      ],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    render(
      <AnalysisStoreProvider initialAnalysis={initialAnalysis} analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveValue('in');
  });

  it('shows an empty string in the input when no gloss has been set', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveValue('');
  });

  it('calls the store onGlossChange spy once on blur with the final value', async () => {
    const spy = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onGlossChange={spy}>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for hello' }), 'in');
    expect(spy).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('GEN 1:1:0', 'in');
  });

  it('does not call the store onGlossChange spy when blurring without typing', async () => {
    const spy = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onGlossChange={spy}>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for hello' }));
    await userEvent.tab();
    expect(spy).not.toHaveBeenCalled();
  });

  it('calls onFocus when the input is focused', async () => {
    const handleFocus = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onFocus={handleFocus} />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for hello' }));
    expect(handleFocus).toHaveBeenCalledTimes(1);
  });

  it('does not call onFocus when disabled', async () => {
    const handleFocus = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} disabled onFocus={handleFocus} />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for hello' }));
    expect(handleFocus).not.toHaveBeenCalled();
  });

  it('renders remove button when onRemove is provided', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={jest.fn()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('button', { name: 'Remove hello from phrase' })).toBeInTheDocument();
  });

  it('does not render remove button when onRemove is not provided', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(
      screen.queryByRole('button', { name: 'Remove hello from phrase' }),
    ).not.toBeInTheDocument();
  });

  it('calls onRemove when the remove button is clicked', async () => {
    const onRemove = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={onRemove} />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove hello from phrase' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('applies destructive border on the remove button when hovered', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={jest.fn()} />
      </AnalysisStoreProvider>,
    );
    const removeBtn = screen.getByRole('button', { name: 'Remove hello from phrase' });
    await userEvent.hover(removeBtn);
    expect(removeBtn.className).toContain('tw:border-destructive');
  });

  it('removes destructive border when pointer leaves the remove button', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={jest.fn()} />
      </AnalysisStoreProvider>,
    );
    const removeBtn = screen.getByRole('button', { name: 'Remove hello from phrase' });
    await userEvent.hover(removeBtn);
    await userEvent.unhover(removeBtn);
    expect(removeBtn.className).not.toContain('tw:border-destructive');
  });

  it('clears remove-hover state when onRemove changes from a function to undefined', async () => {
    const onRemove = jest.fn();
    const { rerender } = render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={onRemove} />
      </AnalysisStoreProvider>,
    );
    // Hover the remove button to set isRemoveHovered = true
    await userEvent.hover(screen.getByRole('button', { name: 'Remove hello from phrase' }));
    // Rerender without onRemove — the label border should revert to non-destructive
    rerender(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={undefined} />
      </AnalysisStoreProvider>,
    );
    const label = screen.getByText('hello').closest('label');
    expect(label?.className).not.toContain('tw:border-destructive');
  });
});
