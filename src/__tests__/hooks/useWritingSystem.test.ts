/// <reference types="jest" />

import { useProjectSetting } from '@papi/frontend/react';
import { renderHook } from '@testing-library/react';
import useWritingSystem from '../../hooks/useWritingSystem';

/** Mock PlatformError shape */
type PlatformError = { message: string; platformErrorVersion: number };

function mockLanguageTag(tag: string | PlatformError) {
  jest.mocked(useProjectSetting).mockReturnValue([tag, jest.fn(), jest.fn(), false]);
}

describe('useWritingSystem', () => {
  it("reports the project's language tag", () => {
    mockLanguageTag('el');

    const { result } = renderHook(() => useWritingSystem('test-project'));

    expect(result.current).toBe('el');
    expect(useProjectSetting).toHaveBeenCalledWith('test-project', 'platform.languageTag', '');
  });

  it('falls back to "und" when the language tag cannot be read', () => {
    mockLanguageTag({ message: 'Setting unavailable', platformErrorVersion: 1 });

    const { result } = renderHook(() => useWritingSystem('test-project'));

    expect(result.current).toBe('und');
  });

  it('falls back to "und" for an empty language tag', () => {
    mockLanguageTag('');

    const { result } = renderHook(() => useWritingSystem('test-project'));

    expect(result.current).toBe('und');
  });
});
