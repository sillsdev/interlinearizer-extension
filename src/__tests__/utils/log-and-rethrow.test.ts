/// <reference types="jest" />

import { logAndRethrow } from '../../utils/log-and-rethrow';

describe('logAndRethrow', () => {
  it('resolves to what the run resolves to, logging nothing', async () => {
    const logger = { error: jest.fn() };

    await expect(logAndRethrow(logger, 'count', async () => 3)).resolves.toBe(3);

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a rejection as a failure to do what it names, then rejects with the same error', async () => {
    const logger = { error: jest.fn() };
    const error = new Error('refused');

    await expect(
      logAndRethrow(logger, 'count usages in session s1', () => Promise.reject(error)),
    ).rejects.toBe(error);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]).toHaveLength(2);
    const [[message, logged]] = logger.error.mock.calls;
    expect(message).toBe('Interlinearizer: failed to count usages in session s1');
    // `toHaveBeenCalledWith` would accept any error with the same message.
    expect(logged).toBe(error);
  });

  it('logs and rejects with an error the run throws before it returns a promise', async () => {
    const logger = { error: jest.fn() };
    const error = new Error('bad request');

    await expect(
      logAndRethrow(logger, 'count', () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]).toHaveLength(2);
    const [[message, logged]] = logger.error.mock.calls;
    expect(message).toBe('Interlinearizer: failed to count');
    expect(logged).toBe(error);
  });
});
