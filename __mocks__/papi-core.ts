/**
 * Jest mock for @papi/core. main.ts imports only types from here (ExecutionActivationContext,
 * IWebViewProvider, SavedWebViewDefinition, WebViewDefinition); types are erased at runtime so this
 * mock only needs to exist for module resolution.
 */
module.exports = {};
