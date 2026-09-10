/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import { linkLabelContent } from '../../components/link-label';

const LABEL = 'Link to {phrase}';

describe('linkLabelContent', () => {
  it('reads as one sentence with the phrase in place', () => {
    render(<p data-testid="label">{linkLabelContent(LABEL, 'en, el')}</p>);
    expect(screen.getByTestId('label')).toHaveTextContent('Link to en, el');
  });

  it('sets the phrase in bold rather than in the running text', () => {
    render(<p>{linkLabelContent(LABEL, 'en, el')}</p>);
    expect(screen.getByText('en, el').tagName).toBe('STRONG');
  });

  it('bolds the phrase whole, gap mark and all', () => {
    render(<p>{linkLabelContent(LABEL, 'ne _ pas')}</p>);
    expect(screen.getByText('ne _ pas').tagName).toBe('STRONG');
  });

  it('renders a label carrying no placeholder as its own text', () => {
    render(<p data-testid="label">{linkLabelContent('Link words', '')}</p>);
    expect(screen.getByTestId('label')).toHaveTextContent('Link words');
  });
});
