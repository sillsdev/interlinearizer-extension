/**
 * Storage key that puts the WebView on the host path when set to `'true'`. On that path, the
 * WebView reads pages and sends commands through a session.
 */
export const HOST_PATH_STORAGE_KEY = 'interlinearizer.hostPath';

let enabled: boolean | undefined;

/** Whether this window runs on the host path, decided once per window. */
export function hostPathEnabled(): boolean {
  if (enabled === undefined) {
    try {
      enabled = globalThis.localStorage?.getItem(HOST_PATH_STORAGE_KEY) === 'true';
    } catch {
      enabled = false;
    }
  }
  return enabled;
}
