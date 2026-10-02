/// <reference types="jest" />

import {
  DELETION_ANNOUNCEMENT_STRING_KEYS,
  deletionAnnouncement,
} from '../../utils/deletion-announcement';

/** Templates short enough to read the chosen case and its substitutions straight off the result. */
const STRINGS: Record<(typeof DELETION_ANNOUNCEMENT_STRING_KEYS)[number], string> = {
  '%interlinearizer_analysisCatalog_deleted%': 'Deleted {form}.',
  '%interlinearizer_analysisCatalog_deleteBlank%': '{count} blank.',
  '%interlinearizer_analysisCatalog_deleteBlankNone%': 'Nothing changed.',
  '%interlinearizer_analysisCatalog_deleteFallback%': '{count} to {gloss}.',
  '%interlinearizer_analysisCatalog_deleteFallbackNoGloss%': '{count} to another.',
  '%interlinearizer_analysisCatalog_deleteFallbackUncertain%': '{count} uncertain.',
  '%interlinearizer_analysisCatalog_deleteUnapplied%': '{count} unapplied.',
};

describe('deletionAnnouncement', () => {
  it('names the deleted analysis and the uses it left blank', () => {
    expect(
      deletionAnnouncement('λόγος', { kind: 'blank', usageCount: 2, unappliedCount: 0 }, STRINGS),
    ).toBe('Deleted λόγος. 2 blank.');
  });

  it('says nothing changed when no use was left blank', () => {
    expect(
      deletionAnnouncement('λόγος', { kind: 'blank', usageCount: 0, unappliedCount: 0 }, STRINGS),
    ).toBe('Deleted λόγος. Nothing changed.');
  });

  it('names the gloss the uses fell back to', () => {
    expect(
      deletionAnnouncement(
        'ἀρχῇ',
        { kind: 'fallback', usageCount: 3, fallbackGloss: 'beginning', unappliedCount: 0 },
        STRINGS,
      ),
    ).toBe('Deleted ἀρχῇ. 3 to beginning.');
  });

  it('describes a fallback with no gloss to quote', () => {
    expect(
      deletionAnnouncement('ἀρχῇ', { kind: 'fallback', usageCount: 3, unappliedCount: 0 }, STRINGS),
    ).toBe('Deleted ἀρχῇ. 3 to another.');
  });

  it('describes rather than names an uncertain fallback', () => {
    expect(
      deletionAnnouncement(
        'ἀρχῇ',
        {
          kind: 'fallback',
          usageCount: 3,
          fallbackGloss: 'beginning',
          uncertain: true,
          unappliedCount: 0,
        },
        STRINGS,
      ),
    ).toBe('Deleted ἀρχῇ. 3 uncertain.');
  });

  it('adds the unapproved records the deletion took with it', () => {
    expect(
      deletionAnnouncement('λόγος', { kind: 'blank', usageCount: 2, unappliedCount: 4 }, STRINGS),
    ).toBe('Deleted λόγος. 2 blank. 4 unapplied.');
  });
});
