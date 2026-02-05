/**
 * Jest mock for webpack ?inline component import (interlinearizer.web-view?inline). Exports a dummy
 * function so main.ts can pass it to the WebView provider without pulling in React.
 */
function MockWebViewComponent() {
  return undefined;
}

module.exports = MockWebViewComponent;
