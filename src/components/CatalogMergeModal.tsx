import type { TokenAnalysis } from 'interlinearizer';
import { Button } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useState } from 'react';
import { ModalShell } from './modals/ModalShell';
import { resolvedOrEmpty } from '../utils/localized-strings';

/** Localized string keys the merge picker renders. */
export const MERGE_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_mergeTitle%',
  '%interlinearizer_analysisCatalog_mergePrompt%',
  '%interlinearizer_analysisCatalog_mergePeerUsageCount%',
  '%interlinearizer_analysisCatalog_mergeCancel%',
  '%interlinearizer_analysisCatalog_mergeConfirm%',
  '%interlinearizer_analysisCatalog_noGloss%',
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogMergeModal}. */
type CatalogMergeModalProps = Readonly<{
  /** Surface form of the analysis being merged away, named in the title. */
  surfaceText: string;
  /** The analyses this one may be merged into: its pool peers, most-used first. */
  peers: readonly TokenAnalysis[];
  /** How many tokens approve each peer, keyed by analysis id, for the choices to be ranked by. */
  usageCountByAnalysisId: ReadonlyMap<string, number>;
  /** BCP 47 tag the peers' glosses are read under. */
  analysisLanguage: string;
  /** Commits the merge into the chosen target. */
  onConfirm: (targetAnalysisId: string) => void;
  /** Backs out, leaving both analyses untouched. */
  onCancel: () => void;
  /** Resolved localizations covering at least {@link MERGE_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/**
 * Picks which analysis to merge a row into, from its pool peers alone — the records sharing its
 * surface form, which are the only ones a merge could sensibly reassign its tokens to.
 *
 * Nothing is preselected: a merge moves every use of one analysis onto another and drops the
 * source, so the target is a decision to make rather than one to default into. Confirm stays
 * disabled until a choice is made.
 */
export default function CatalogMergeModal({
  surfaceText,
  peers,
  usageCountByAnalysisId,
  analysisLanguage,
  onConfirm,
  onCancel,
  localizedStrings,
}: CatalogMergeModalProps) {
  const [targetId, setTargetId] = useState<string | undefined>(undefined);

  // Visible cell text, so an unresolved key would leave a peer nameless in a list the reader
  // chooses from. The em dash reads as "no gloss" in any language, as it does in the listing.
  const noGloss =
    resolvedOrEmpty(localizedStrings['%interlinearizer_analysisCatalog_noGloss%']) || '—';

  return (
    <ModalShell
      onClose={onCancel}
      title={formatReplacementString(
        localizedStrings['%interlinearizer_analysisCatalog_mergeTitle%'],
        { form: surfaceText },
      )}
      titleTestId="catalog-merge-title"
      width="tw:w-96"
    >
      <p className="tw:text-sm tw:text-muted-foreground">
        {localizedStrings['%interlinearizer_analysisCatalog_mergePrompt%']}
      </p>

      <ul className="tw:mt-3 tw:flex tw:flex-col tw:max-h-64 tw:overflow-y-auto">
        {peers.map((peer) => (
          <li key={peer.id}>
            <Button
              aria-pressed={peer.id === targetId}
              // Overrides the platform button's own box so the choice reads as a row of the list.
              className={`tw:flex tw:h-auto tw:w-full tw:items-baseline tw:justify-start tw:gap-2 tw:px-2 tw:py-1.5 tw:text-start tw:font-normal ${
                peer.id === targetId ? 'tw:bg-accent' : ''
              }`}
              data-analysis-id={peer.id}
              data-testid="catalog-merge-peer"
              onClick={() => setTargetId(peer.id)}
              type="button"
              variant="ghost"
            >
              <span className="tw:flex-1 tw:min-w-0 tw:truncate">
                {peer.gloss?.[analysisLanguage] || noGloss}
              </span>
              <span className="tw:text-xs tw:tabular-nums tw:text-muted-foreground">
                {formatReplacementString(
                  localizedStrings['%interlinearizer_analysisCatalog_mergePeerUsageCount%'],
                  /* v8 ignore next -- every peer is a row of the listing the map was built from */
                  { count: usageCountByAnalysisId.get(peer.id) ?? 0 },
                )}
              </span>
            </Button>
          </li>
        ))}
      </ul>

      <div className="tw:mt-4 tw:flex tw:justify-end tw:gap-2">
        <Button data-testid="catalog-merge-cancel" onClick={onCancel} variant="outline">
          {localizedStrings['%interlinearizer_analysisCatalog_mergeCancel%']}
        </Button>
        <Button
          data-testid="catalog-merge-confirm"
          disabled={!targetId}
          onClick={() => targetId && onConfirm(targetId)}
        >
          {localizedStrings['%interlinearizer_analysisCatalog_mergeConfirm%']}
        </Button>
      </div>
    </ModalShell>
  );
}
