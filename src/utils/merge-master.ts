import type { Confidence, MorphemeAnalysis, TokenAnalysis } from 'interlinearizer';
import { analysesAreIdentical } from './analysis-identity';
import type { CatalogRow } from './analysis-query';

/**
 * What a merge would write onto the surviving analysis: the content of the master panel, assembled
 * from the ordered analyses and whatever the reader has typed over them.
 */
export interface MergeMaster {
  /** Gloss in the analysis language, `''` when the merge would leave the survivor without one. */
  gloss: string;
  morphemes: readonly MorphemeAnalysis[];
  pos?: string;
  features?: Readonly<Record<string, string>>;
  confidence?: Confidence;
}

/**
 * Stands for a field the reader emptied, which an optional field cannot say by holding `undefined`
 * — that is how {@link MergeMasterEdits} says the field was never touched. Emptying one is a
 * decision that the merge should write nothing there, and no analysis may fill it back in.
 */
export const CLEARED = Symbol('cleared');

/** A field's edit: what to write, or {@link CLEARED} to write nothing. */
type Edited<T> = T | typeof CLEARED;

/** What the reader has typed over the derived master, each field absent until they touch it. */
export interface MergeMasterEdits {
  gloss?: string;
  /**
   * The breakdown as a list of forms, glosses excluded — a form this leaves standing keeps whatever
   * gloss it had.
   */
  morphemeForms?: readonly string[];
  /**
   * Each morpheme's gloss by form, so an edit outlives a re-derivation that rebuilds the objects.
   * An entry of `''` records that the morpheme should carry no gloss, which no donor may fill in.
   */
  morphemeGlosses?: Readonly<Record<string, string>>;
  pos?: Edited<string>;
  features?: Edited<Readonly<Record<string, string>>>;
  confidence?: Edited<Confidence>;
}

/** The state a merge panel derives its master from. */
export interface MergeMasterInput {
  /** The analyses of the form, the survivor first — the order fallback reads down. */
  order: readonly CatalogRow[];
  /** Which analyses the merge would fold in, the survivor always among them. */
  checked: ReadonlySet<string>;
  edits: MergeMasterEdits;
  /** BCP 47 tag the glosses are read and written under. */
  analysisLanguage: string;
  /** Writing system a re-split breakdown's minted morphemes are recorded under. */
  sourceLanguageTag: string;
}

/**
 * Whether the merge may be confirmed, and what stands in its way or awaits it.
 *
 * A merge that would converge is allowed rather than refused — the collapse is what the store does
 * with two records saying the same thing, and the reader can mean it — and names the record it
 * would absorb.
 */
export type MergeVerdict =
  | { canConfirm: false; reason: 'nothing-checked'; collapsingAnalysisId?: undefined }
  | { canConfirm: true; reason: 'will-collapse'; collapsingAnalysisId: string }
  | { canConfirm: true; reason?: undefined; collapsingAnalysisId?: undefined };

/** What the panel shows and what confirming it would do. */
export interface MergeMasterDerivation {
  /** The content the merge would write, which is what the editable fields are filled from. */
  master: MergeMaster;
  verdict: MergeVerdict;
}

/** How a reorder leaves the arrangement and the merge set. */
export interface MergeReorder {
  /** The analyses most-preferred first, the survivor at its head. */
  orderedIds: readonly string[];
  /** The analyses folded in besides the survivor. */
  mergedIds: ReadonlySet<string>;
}

/**
 * Moves one analysis to a new place in the arrangement, keeping the merge set honest about what the
 * move did: an analysis displaced from the head was going to survive, so it stays in the merge
 * rather than dropping out of it, and the one taking its place leaves the set it now heads.
 *
 * Moving an analysis to where it already sits changes nothing.
 */
export function reorderForMerge(
  current: MergeReorder,
  analysisId: string,
  toIndex: number,
): MergeReorder {
  const from = current.orderedIds.indexOf(analysisId);
  if (from === -1 || from === toIndex) return current;

  const orderedIds = [...current.orderedIds];
  orderedIds.splice(from, 1);
  orderedIds.splice(toIndex, 0, analysisId);

  const [survivor] = current.orderedIds;
  const [nextSurvivor] = orderedIds;
  if (nextSurvivor === survivor) return { orderedIds, mergedIds: current.mergedIds };

  const mergedIds = new Set(current.mergedIds);
  mergedIds.add(survivor);
  mergedIds.delete(nextSurvivor);
  return { orderedIds, mergedIds };
}

/**
 * A row read as the stored analysis it stands for, so convergence is judged by the same rule the
 * store dedupes by rather than by a second definition of sameness that could drift from it.
 *
 * The id and timestamps are placeholders, sameness resting on content alone.
 */
function asAnalysis(
  content: Pick<CatalogRow, 'gloss' | 'morphemes' | 'pos' | 'features'>,
  surfaceText: string,
  analysisLanguage: string,
): TokenAnalysis {
  return {
    id: '',
    createdAt: '',
    updatedAt: '',
    surfaceText,
    gloss: content.gloss ? { [analysisLanguage]: content.gloss } : undefined,
    morphemes: [...content.morphemes],
    pos: content.pos,
    features: content.features ? { ...content.features } : undefined,
  };
}

/**
 * Whether the merge may go ahead, and what qualifies it: a merge needs something to fold in beyond
 * the survivor, an edit on its own being no merge at all, and one that would converge is allowed
 * but named so it can be said what is about to be absorbed.
 */
function verdictFor(
  donors: readonly CatalogRow[],
  collapsingAnalysisId: string | undefined,
): MergeVerdict {
  if (donors.length < 2) return { canConfirm: false, reason: 'nothing-checked' };
  if (collapsingAnalysisId)
    return { canConfirm: true, reason: 'will-collapse', collapsingAnalysisId };
  return { canConfirm: true };
}

/**
 * Assembles the master a merge would write from the ordered analyses, the reader's edits over them,
 * and which analyses are being folded in.
 *
 * A field the survivor lacks is filled from the next analysis down that has one, which is why the
 * order is the reader's to arrange: it ranks the donors. Only analyses being folded in may donate —
 * one left unchecked survives on its own and has no business putting content into another record.
 */
export function deriveMergeMaster({
  order,
  checked,
  edits,
  analysisLanguage,
  sourceLanguageTag,
}: MergeMasterInput): MergeMasterDerivation {
  const donors = order.filter((r) => checked.has(r.analysisId));

  /** The first donor's value for a field, the survivor's own coming first among them. */
  const donated = <T>(read: (r: CatalogRow) => T | undefined): T | undefined =>
    donors.map(read).find((value) => value !== undefined);

  // Taken whole rather than assembled morpheme by morpheme: a breakdown is one reading of the word,
  // and forms drawn from two of them would segment it a way no analysis actually claims.
  const derivedBreakdown = donors.map((r) => r.morphemes).find((forms) => forms.length > 0) ?? [];

  // A breakdown edit supplies forms alone, so the morphemes under it are rebuilt rather than
  // carried: an edit that leaves a form standing recovers its gloss below, by form.
  const breakdown: readonly MorphemeAnalysis[] = edits.morphemeForms
    ? edits.morphemeForms.map((form, index) => ({
        id: `master-${index}`,
        form,
        writingSystem: sourceLanguageTag,
      }))
    : derivedBreakdown;

  /** The gloss any checked analysis gives a form, the highest-ranked donor's winning. */
  const donatedMorphemeGloss = (form: string) =>
    donors.flatMap((r) => r.morphemes).find((m) => m.form === form && m.gloss?.[analysisLanguage])
      ?.gloss?.[analysisLanguage];

  // Glosses fill in per morpheme, matched by form: unlike the segmentation, a gloss says what one
  // morpheme means, which a donor that reached the same form is saying about the same thing. Keying
  // the reader's own edits by form too is what drops them when the breakdown stops carrying it.
  const morphemes = breakdown.map((m) => {
    const gloss = edits.morphemeGlosses?.[m.form] ?? donatedMorphemeGloss(m.form);
    // An edit of `''` empties the gloss rather than leaving whatever the morpheme arrived carrying:
    // emptying one is a decision that it should carry none, which is what no gloss at all says.
    if (gloss === '') {
      const rest = Object.fromEntries(
        Object.entries(m.gloss ?? {}).filter(([tag]) => tag !== analysisLanguage),
      );
      return { ...m, gloss: Object.keys(rest).length > 0 ? rest : undefined };
    }
    if (gloss === undefined) return m;
    return { ...m, gloss: { ...m.gloss, [analysisLanguage]: gloss } };
  });

  /** One optional field's settled value: its edit where there is one, else what a donor gives. */
  const settled = <T>(edit: Edited<T> | undefined, read: (r: CatalogRow) => T | undefined) => {
    if (edit === CLEARED) return undefined;
    return edit ?? donated(read);
  };

  // An edit stands whatever the analyses say, a blank one included: emptying a field is a decision
  // about what the merge should write, not an absence for a lower analysis to fill.
  const master: MergeMaster = {
    gloss: edits.gloss ?? donated((r) => r.gloss || undefined) ?? '',
    morphemes,
    pos: settled(edits.pos, (r) => r.pos),
    features: settled(edits.features, (r) => r.features),
    confidence: settled(edits.confidence, (r) => r.confidence),
  };

  const [survivor] = order;

  // Judged against what the merge would leave standing, so a record being folded in is not read as
  // a record the survivor is about to collide with.
  const written = asAnalysis(master, survivor.surfaceText, analysisLanguage);
  const collapsing = order.find(
    (r) =>
      !checked.has(r.analysisId) &&
      analysesAreIdentical(written, asAnalysis(r, r.surfaceText, analysisLanguage)),
  );

  return { master, verdict: verdictFor(donors, collapsing?.analysisId) };
}
