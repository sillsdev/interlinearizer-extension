/// <reference types="jest" />
/* eslint-disable no-console -- These tests log so that the console guard has something to catch. */

it('schedules an error for after the file ends', () => {
  setTimeout(() => console.error('error after the last test'), 0);
});
