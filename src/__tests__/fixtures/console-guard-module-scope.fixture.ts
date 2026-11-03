/// <reference types="jest" />
/* eslint-disable no-console -- This file logs so that the console guard has something to catch. */

console.warn('warning from loading the file');

it('runs first after a module-scope log', () => {});

it('runs second after a module-scope log', () => {});
