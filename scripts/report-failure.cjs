const fs = require('fs');

/**
 * Reports a multi-line failure and stops.
 *
 * @param lines - Written as given, so each carries its own ✗ or ℹ marker.
 */
function failWith(lines) {
  // Written synchronously because `process.exit` does not wait for an asynchronous write, and
  // stderr is asynchronous on a Windows terminal and, by contract, on a POSIX pipe — which is what
  // it is whenever CI captures a run. A report cut short names fewer problems than were found.
  fs.writeSync(2, `${lines.join('\n')}\n`);
  process.exit(1);
}

/** Reports a failure and stops: what went wrong, then what to do about it. */
function fail(reason, hint) {
  failWith([`✗ ${reason}`, `ℹ ${hint}`]);
}

module.exports = { fail, failWith };
