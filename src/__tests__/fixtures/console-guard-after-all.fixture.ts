/// <reference types="jest" />
/* eslint-disable no-console -- This hook logs so that the console guard has something to catch. */

afterAll(() => {
  console.error('error from file teardown');
});

it('passes before the file tears down', () => {});
