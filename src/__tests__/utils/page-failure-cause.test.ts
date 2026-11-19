/// <reference types="jest" />

import { pageFailureCauseOf, readNamingCause } from '../../utils/page-failure-cause';

/** What a read that throws `thrown` rejects with, once its error names `cause`. */
async function errorNaming(cause: 'text' | 'analysis', thrown: unknown): Promise<unknown> {
  return readNamingCause(cause, async () => {
    throw thrown;
  }).catch((error: unknown) => error);
}

describe('readNamingCause', () => {
  it('resolves what the read resolves', async () => {
    await expect(readNamingCause('text', async () => 'page')).resolves.toBe('page');
  });

  it('keeps the message of the error that the read throws', async () => {
    const error = await errorNaming('text', new Error('unreadable'));

    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error && error.message).toContain('unreadable');
  });

  it('keeps a thrown value that is not an error as a string', async () => {
    const error = await errorNaming('analysis', 'unreadable');

    expect(error instanceof Error && error.message).toContain('unreadable');
  });
});

describe('pageFailureCauseOf', () => {
  it.each(['text', 'analysis'] as const)('reads a %s cause that an error names', async (cause) => {
    expect(pageFailureCauseOf(await errorNaming(cause, new Error('unreadable')))).toBe(cause);
  });

  it('reads the cause that a PAPI error names after the request error it opens with', async () => {
    const named = await errorNaming('text', new Error('unreadable'));
    const message = named instanceof Error ? named.message : '';

    expect(pageFailureCauseOf({ code: 0, message: `JSON-RPC Request error (0): ${message}` })).toBe(
      'text',
    );
  });

  it('reads the cause that an error object from another realm names', async () => {
    const named = await errorNaming('analysis', new Error('unreadable'));
    // An object without Object's prototype fails `instanceof Object`, as one from another realm does.
    // eslint-disable-next-line no-null/no-null -- only a null prototype leaves Object's out
    const foreign: { message?: string } = Object.create(null);
    foreign.message = named instanceof Error ? named.message : '';

    expect(pageFailureCauseOf(foreign)).toBe('analysis');
  });

  it('blames the app for an error that names no cause', () => {
    expect(pageFailureCauseOf(new Error('timed out'))).toBe('app');
  });

  it('blames the app for a thrown value that is not an error', () => {
    expect(pageFailureCauseOf(undefined)).toBe('app');
  });
});
