import fs from 'fs';
import path from 'path';
import { DATASETS_DIR } from '../paths';
import type { TierSpec } from './tiers';

/** What a generated dataset holds, recorded beside it so results can be read against its size. */
export interface DatasetManifest {
  tier: TierSpec;
  seed: number;
  sourceProjectId: string;
  /** Paranext-core commit whose USJ the dataset was generated from. */
  coreCommit: string;
  books: string[];
  counts: {
    segments: number;
    wordTokens: number;
    tokenAnalyses: number;
    tokenAnalysisLinks: Record<string, number>;
    phraseAnalyses: number;
    phraseAnalysisLinks: number;
    segmentAnalyses: number;
  };
  bytes: {
    /** The draft as `saveDraft` receives it. */
    draftJson: number;
    /** The largest one book's shard of the draft as storage holds it. */
    largestShard: number;
  };
}

function tierDir(tier: string): string {
  return path.join(DATASETS_DIR, tier);
}

/** Stores a generated tier beside its manifest. */
export function writeDataset(manifest: DatasetManifest, draftJson: string): void {
  const dir = tierDir(manifest.tier.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'draft.json'), draftJson);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, undefined, 2));
}

/** Reads a generated tier's manifest. */
export function readManifest(tier: string): DatasetManifest {
  return JSON.parse(fs.readFileSync(path.join(tierDir(tier), 'manifest.json'), 'utf-8'));
}

/** The draft exactly as generated, unparsed, so a caller measuring serialization starts from text. */
export function readDraftJson(tier: string): string {
  return fs.readFileSync(path.join(tierDir(tier), 'draft.json'), 'utf-8');
}
