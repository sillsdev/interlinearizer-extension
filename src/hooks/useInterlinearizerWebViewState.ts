import type { UseWebViewStateHook } from '@papi/core';
import type { InterlinearizerWebViewState } from '../types/webview-state';

/**
 * Reads and writes a WebView state entry that the extension host also seeds or reads. Its key and
 * value type are checked against what the host expects.
 */
export default function useInterlinearizerWebViewState<K extends keyof InterlinearizerWebViewState>(
  useWebViewState: UseWebViewStateHook,
  key: K,
  defaultValue: InterlinearizerWebViewState[K],
) {
  return useWebViewState(key, defaultValue);
}
