/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import useExtendAnchor from '../../hooks/useExtendAnchor';

/** An attached element whose viewport position the test sets and moves by hand. */
function positionedEl(parent: HTMLElement, position: number) {
  const el = document.createElement('div');
  parent.appendChild(el);
  const move = (to: number) => {
    el.getBoundingClientRect = () => DOMRect.fromRect({ x: to, y: to, width: 10, height: 10 });
  };
  move(position);
  return { el, move };
}

/** Renders the hook over a fresh, attached container. */
function renderAnchor(axis: 'vertical' | 'horizontal') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const { result } = renderHook(() => useExtendAnchor(axis, { current: container }));
  return { container, anchor: result.current };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useExtendAnchor', () => {
  it('scrolls by how far the anchor moved, keeping the first anchor recorded', () => {
    const { container, anchor } = renderAnchor('vertical');
    const first = positionedEl(container, 100);
    const second = positionedEl(container, 500);
    container.scrollTop = 50;

    anchor.record(first.el);
    anchor.record(second.el);
    first.move(400);
    second.move(900);

    expect(anchor.restore()).toBe(true);
    expect(container.scrollTop).toBe(350);
  });

  it('scrolls the inline axis for a horizontal window', () => {
    const { container, anchor } = renderAnchor('horizontal');
    const group = positionedEl(container, 100);
    container.scrollLeft = 100;

    anchor.record(group.el);
    group.move(40);

    expect(anchor.restore()).toBe(true);
    expect(container.scrollLeft).toBe(40);
  });

  it('reports nothing pending once an anchor is restored', () => {
    const { container, anchor } = renderAnchor('vertical');
    anchor.record(positionedEl(container, 100).el);
    anchor.restore();

    expect(anchor.restore()).toBe(false);
  });

  it('leaves the scroll alone when the anchor was unmounted', () => {
    const { container, anchor } = renderAnchor('vertical');
    const segment = positionedEl(container, 100);
    container.scrollTop = 50;

    anchor.record(segment.el);
    segment.move(400);
    segment.el.remove();

    expect(anchor.restore()).toBe(true);
    expect(container.scrollTop).toBe(50);
  });
});
