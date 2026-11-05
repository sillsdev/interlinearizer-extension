/// <reference types="jest" />
/* eslint-disable no-console -- These tests log so that the console guard has something to catch. */

it('logs an error', () => {
  console.error('unexpected error');
});

it('logs a warning', () => {
  console.warn('unexpected warning');
});

it('logs an expected error through a spy', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  console.error('expected error');
});

it('schedules an error for after it ends', () => {
  setTimeout(() => console.error('late error'), 0);
});

it('runs while a late error lands', async () => {
  await new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
});

it('logs a slow Redux invariant check', () => {
  console.warn(
    'SerializableStateInvariantMiddleware took 36ms, which is more than the warning threshold of 32ms.',
  );
});

it('logs an error worded as a slow Redux invariant check', () => {
  console.error(
    'SerializableStateInvariantMiddleware took 36ms, which is more than the warning threshold of 32ms.',
  );
});
