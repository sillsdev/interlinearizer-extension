/** Reports a failure and stops: what went wrong, then what to do about it. */
function fail(reason, hint) {
  console.error(`✗ ${reason}`);
  console.error(`ℹ ${hint}`);
  process.exit(1);
}

module.exports = { fail };
