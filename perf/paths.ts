import path from 'path';

/** Root of the performance harness. */
export const PERF_DIR = __dirname;

/** Gitignored scratch space for captured text and generated datasets. */
export const CACHE_DIR = path.join(PERF_DIR, '.cache');

/** Captured USJ, one directory per source project. */
export const USJ_CACHE_DIR = path.join(CACHE_DIR, 'usj');

/** Generated datasets, one directory per tier. */
export const DATASETS_DIR = path.join(CACHE_DIR, 'datasets');

/** Committed result files. */
export const RESULTS_DIR = path.join(PERF_DIR, 'results');

/** The development app's storage for this extension's projects and drafts. */
export const DEV_STORAGE_DIR = path.resolve(
  PERF_DIR,
  '../../paranext-core/dev-appdata/extensions/interlinearizer/user-data',
);

/** Short name of the platform's bundled sample project, the text every tier is drawn from. */
export const SOURCE_PROJECT_NAME = 'WEB';

/** Directory holding one project's captured USJ. */
export function usjDirFor(projectId: string): string {
  return path.join(USJ_CACHE_DIR, projectId);
}
