/**
 * Jest setup file. Runs before each test file. Extends expect with @testing-library/jest-dom
 * matchers for React component tests, and fails any test that calls `console.error` or
 * `console.warn`.
 */
import '@testing-library/jest-dom';
import { format } from 'node:util';

const unexpectedLogs: string[] = [];
// Captured before any test can install fake timers, which would leave the end-of-file wait hanging.
const realSetTimeout = setTimeout;

(['error', 'warn'] as const).forEach((level) => {
  // eslint-disable-next-line no-console -- The guard replaces the console's own methods.
  console[level] = (...args: unknown[]) => {
    const stack = new Error().stack?.split('\n').slice(2).join('\n');
    unexpectedLogs.push(`console.${level}: ${format(...args)}\n${stack}`);
  };
});

function failOnUnexpectedLogs() {
  if (unexpectedLogs.length === 0) return;
  const logs = unexpectedLogs.splice(0);
  throw new Error(`Unexpected console output:\n\n${logs.join('\n\n')}`);
}

afterEach(failOnUnexpectedLogs);

afterAll(async () => {
  // Waits one turn so that a timer left by the file's last test can log.
  await new Promise((resolve) => {
    realSetTimeout(resolve, 0);
  });
  failOnUnexpectedLogs();
});
