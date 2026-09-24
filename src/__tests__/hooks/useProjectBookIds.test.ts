/// <reference types="jest" />

import { useProjectSetting } from '@papi/frontend/react';
import { renderHook } from '@testing-library/react';
import type { PlatformError } from 'platform-bible-utils';
import useProjectBookIds from '../../hooks/useProjectBookIds';

/** `booksPresent` flags are indexed by canonical book number: GEN is 1, PHP is 50. */
const GEN_AND_PHP = `1${'0'.repeat(48)}1`;

function mockBooksPresent(value: string | PlatformError): void {
  jest.mocked(useProjectSetting).mockReturnValue([value, jest.fn(), jest.fn(), false]);
}

describe('useProjectBookIds', () => {
  it("lists the project's books in canonical order", () => {
    mockBooksPresent(GEN_AND_PHP);

    const { result } = renderHook(() => useProjectBookIds('project-1'));

    expect(result.current).toEqual(['GEN', 'PHP']);
  });

  it('reads the booksPresent setting of the given project', () => {
    mockBooksPresent(GEN_AND_PHP);

    renderHook(() => useProjectBookIds('project-1'));

    expect(useProjectSetting).toHaveBeenCalledWith(
      'project-1',
      'platformScripture.booksPresent',
      '',
    );
  });

  it('returns undefined while the setting has not arrived', () => {
    mockBooksPresent('');

    const { result } = renderHook(() => useProjectBookIds('project-1'));

    expect(result.current).toBeUndefined();
  });

  it('returns undefined when the platform reports an error', () => {
    mockBooksPresent({ message: 'Setting failed', platformErrorVersion: 1 });

    const { result } = renderHook(() => useProjectBookIds('project-1'));

    expect(result.current).toBeUndefined();
  });

  it('keeps the same list across renders while the setting is unchanged', () => {
    mockBooksPresent(GEN_AND_PHP);

    const { result, rerender } = renderHook(() => useProjectBookIds('project-1'));
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });
});
