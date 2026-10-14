/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import CatalogList from '../../components/CatalogList';

/** The list holding `rows`, with both refs recorded. */
function renderList(rows: readonly string[]) {
  const scrollRef = jest.fn();
  const sentinelRef = jest.fn();
  render(
    <CatalogList scrollRef={scrollRef} sentinelRef={sentinelRef}>
      {rows.map((id) => (
        <li key={id} data-testid="row">
          {id}
        </li>
      ))}
    </CatalogList>,
  );
  return { scrollRef, sentinelRef };
}

describe('CatalogList', () => {
  it('lists the rows it is given, in order', () => {
    renderList(['a', 'b']);

    expect(screen.getAllByTestId('row').map((el) => el.textContent)).toEqual(['a', 'b']);
  });

  it('places the sentinel after the last row', () => {
    renderList(['a', 'b']);

    expect(screen.getByRole('list').lastElementChild).toBe(
      screen.getByTestId('catalog-rows-sentinel'),
    );
  });

  it('hides the sentinel from assistive tech', () => {
    renderList(['a']);

    expect(screen.getByTestId('catalog-rows-sentinel')).toHaveAttribute('aria-hidden', 'true');
  });

  it('hands over the element the rows scroll in', () => {
    const { scrollRef } = renderList(['a']);

    expect(scrollRef).toHaveBeenCalledWith(screen.getByRole('list'));
  });

  it('hands over the sentinel', () => {
    const { sentinelRef } = renderList(['a']);

    expect(sentinelRef).toHaveBeenCalledWith(screen.getByTestId('catalog-rows-sentinel'));
  });
});
