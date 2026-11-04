/// <reference types="jest" />
/* eslint-disable no-console -- These hooks log so that the console guard has something to catch. */

let testsRun = 0;

afterEach(() => {
  testsRun += 1;
  if (testsRun === 1) console.warn('warning from cleanup');
});

it('logs from its cleanup', () => {});

it('runs after a cleanup that logged', () => {});
