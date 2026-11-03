import type { Circus } from '@jest/types';
import JSDOMEnvironment from 'jest-environment-jsdom';
import { format } from 'node:util';

/** Redux Toolkit's dev-only warning that an invariant check ran slowly, which load alone can cause. */
const SLOW_INVARIANT_CHECK =
  /^\w+InvariantMiddleware took \d+ms, which is more than the warning threshold/;

/**
 * Jest's jsdom environment, extended to fail any test that calls `console.error` or `console.warn`.
 * Redux Toolkit's warning that an invariant check ran slowly is silenced instead. A log from a
 * test's cleanup hook fails that test. A log from loading the test file, or from its `afterAll`,
 * fails the file.
 */
export default class ConsoleGuardEnvironment extends JSDOMEnvironment {
  private readonly unexpectedLogs: string[] = [];

  async handleTestEvent(event: Circus.Event, state: Circus.State) {
    switch (event.name) {
      case 'setup':
        // Jest installs the test file's console after constructing the environment.
        this.guardConsole();
        break;
      case 'run_start':
        this.takeUnexpectedLogs(state.unhandledErrors);
        break;
      case 'test_done':
        this.takeUnexpectedLogs(event.test.errors);
        break;
      case 'run_finish':
        // Waits one turn so that a timer left by the file's last test can log. Fake timers in the
        // test file never replace this realm's `setTimeout`.
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        this.takeUnexpectedLogs(state.unhandledErrors);
        break;
      default:
    }
  }

  private guardConsole() {
    const { console } = this.global;
    (['error', 'warn'] as const).forEach((level) => {
      console[level] = (...args: unknown[]) => {
        const message = format(...args);
        if (SLOW_INVARIANT_CHECK.test(message)) return;
        const stack = new Error().stack?.split('\n').slice(2).join('\n');
        this.unexpectedLogs.push(`console.${level}: ${message}\n${stack}`);
      };
    });
  }

  private takeUnexpectedLogs(errors: Circus.Exception[]) {
    if (this.unexpectedLogs.length === 0) return;
    const logs = this.unexpectedLogs.splice(0);
    errors.push(new Error(`Unexpected console output:\n\n${logs.join('\n\n')}`));
  }
}
