/**
 * Jest mock for webpack ?inline component import (interlinearizer.web-view?inline). Exports a dummy
 * function so main.ts can pass it to the WebView provider without pulling in React.
 * Returns null so that if this mock is ever rendered as a React component, it follows React
 * semantics (null = render nothing; undefined can trigger strict-mode warnings).
 */
function MockWebViewComponent() {
  return null;
}

module.exports = MockWebViewComponent;
