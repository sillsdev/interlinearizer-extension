/** Returns the storage key for a project by ID. */
export function projectKey(id: string): string {
  return `project:${id}`;
}

/** Returns the storage key for a source project's draft. */
export function draftKey(sourceProjectId: string): string {
  return `draft:${sourceProjectId}`;
}

/** Returns the storage key holding one book's slice of a draft's analysis. */
export function draftAnalysisKey(sourceProjectId: string, bookCode: string): string {
  return `draft:${sourceProjectId}:analysis:${bookCode}`;
}

/** Returns the storage key naming the shards an interrupted save of a draft may have stranded. */
export function draftJournalKey(sourceProjectId: string): string {
  return `draft:${sourceProjectId}:shards`;
}
