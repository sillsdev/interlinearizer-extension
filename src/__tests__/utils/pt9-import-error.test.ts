import type { PlatformError } from 'platform-bible-utils';
import { isPt9TooLargeError } from '../../utils/pt9-import-error';

const MARKER_MESSAGE = 'PT9 interlinear data is too large: the files exceed the cap';

function platformError(message: string, code?: PlatformError['code']): PlatformError {
  return { platformErrorVersion: 1, message, ...(code !== undefined && { code }) };
}

describe('isPt9TooLargeError', () => {
  it('recognizes the RESOURCE_EXHAUSTED platform error code without relying on the message', () => {
    expect(isPt9TooLargeError(platformError('some message', 'RESOURCE_EXHAUSTED'))).toBe(true);
  });

  it('falls back to the message marker on a platform error without the code', () => {
    expect(isPt9TooLargeError(platformError(MARKER_MESSAGE))).toBe(true);
  });

  it('rejects a platform error with neither the code nor the marker', () => {
    expect(isPt9TooLargeError(platformError('something else', 'NOT_FOUND'))).toBe(false);
  });

  it('recognizes the marker on a plain Error', () => {
    expect(isPt9TooLargeError(new Error(MARKER_MESSAGE))).toBe(true);
  });

  it('rejects a plain Error without the marker and values that are no error at all', () => {
    expect(isPt9TooLargeError(new Error('boom'))).toBe(false);
    expect(isPt9TooLargeError(MARKER_MESSAGE)).toBe(false);
  });

  it('rejects a platform error carrying no message instead of throwing', () => {
    // Narrows as a platform error despite omitting the message the type declares as required.
    const noMessage: unknown = { platformErrorVersion: 1 };

    expect(() => isPt9TooLargeError(noMessage)).not.toThrow();
    expect(isPt9TooLargeError(noMessage)).toBe(false);
  });
});
