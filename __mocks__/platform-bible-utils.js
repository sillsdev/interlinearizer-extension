/**
 * Jest mock for platform-bible-utils. Exposes only UnsubscriberAsyncList so test-helpers can build
 * ExecutionActivationContext without loading the real package (which pulls in ESM deps).
 */
class UnsubscriberAsyncList {
  constructor(name = 'Anonymous') {
    this.name = name;
    this.unsubscribers = new Set();
  }

  add(...unsubscribers) {
    unsubscribers.forEach((unsubscriber) => {
      if (
        typeof unsubscriber === 'object' &&
        unsubscriber instanceof Object &&
        'dispose' in unsubscriber
      ) {
        this.unsubscribers.add(unsubscriber.dispose.bind(unsubscriber));
      } else {
        this.unsubscribers.add(unsubscriber);
      }
    });
  }

  async runAllUnsubscribers() {
    const unsubs = [...this.unsubscribers].map((fn) => fn());
    const results = await Promise.all(unsubs);
    this.unsubscribers.clear();
    return results.every(Boolean);
  }
}

module.exports = { UnsubscriberAsyncList };
module.exports.UnsubscriberAsyncList = UnsubscriberAsyncList;
