/** @file Unit tests for utils/status-colors.ts. */
/// <reference types="jest" />

import type { AssignmentStatus } from 'interlinearizer';
import { statusTextColorClass } from '../../utils/status-colors';

describe('statusTextColorClass', () => {
  it.each<[AssignmentStatus, string]>([
    ['approved', 'tw:text-foreground'],
    ['suggested', 'tw:gloss-suggested'],
    ['candidate', 'tw:gloss-candidate'],
    ['rejected', 'tw:gloss-rejected'],
    ['stale', 'tw:gloss-stale'],
  ])('maps %s to %s', (status, expected) => {
    expect(statusTextColorClass(status)).toBe(expected);
  });
});
