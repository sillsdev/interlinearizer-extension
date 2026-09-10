/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import { linkLabelContent } from '../../components/link-label';

const LABEL = 'Link to {phrase}';

const PHRASE = 'the selection';

describe('linkLabelContent', () => {
  it('reads as one sentence with the phrase in place', () => {
    render(<p data-testid="label">{linkLabelContent(LABEL, PHRASE)}</p>);
    expect(screen.getByTestId('label')).toHaveTextContent('Link to the selection');
  });

  it('bolds the phrase and nothing around it', () => {
    const { container } = render(<p>{linkLabelContent(LABEL, PHRASE)}</p>);

    // One bold run holding exactly the phrase, so the wording introducing it stays plain.
    expect([...container.querySelectorAll('strong')].map((node) => node.textContent)).toEqual([
      PHRASE,
    ]);
  });

  it('renders a label carrying no placeholder as its own text', () => {
    render(<p data-testid="label">{linkLabelContent('Link words', '')}</p>);
    expect(screen.getByTestId('label')).toHaveTextContent('Link words');
  });
});
