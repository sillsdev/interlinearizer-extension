import type {
  Confidence,
  EntryRef,
  MorphemeAnalysis,
  MultiString,
  TokenAnalysis,
} from 'interlinearizer';
import { analysesAreIdentical, reconcileMorphemes } from './analysis-identity';
import type { CatalogRow } from './analysis-query';

/**
 * What a merge would write onto the surviving analysis, assembled from the ordered analyses and
 * whatever the reader has typed over them.
 */
export interface MergedContentDraft {
  /** Gloss in the analysis language, `''` when the merge would leave the survivor without one. */
  gloss: string;
  /**
   * Analysis `gloss` was taken from, whose sense the survivor keeps resolving it through. Absent
   * when the reader typed the gloss or the merge settled on none.
   */
  glossFromAnalysisId?: string;
  morphemes: readonly MorphemeAnalysis[];
  /** Settled from the merged analyses alone, no edit reaching it. */
  pos?: string;
  /** Settled from the merged analyses alone, no edit reaching them. */
  features?: Readonly<Record<string, string>>;
  confidence?: Confidence;
}

/**
 * Stands for a field the reader emptied, which an optional field cannot say by holding `undefined`
 * — that is how {@link MergeContentEdits} says the field was never touched. Emptying one is a
 * decision that the merge should write nothing there, and no analysis may fill it back in.
 */
export const CLEARED = Symbol('cleared');

/** A field's edit: what to write, or {@link CLEARED} to write nothing. */
type Edited<T> = T | typeof CLEARED;

/** What the reader has typed over the derived content, each field absent until they touch it. */
export interface MergeContentEdits {
  gloss?: string;
  /**
   * The breakdown as a list of forms alone — a form this leaves standing keeps the morpheme it had,
   * gloss and lexicon references included.
   */
  morphemeForms?: readonly string[];
  /**
   * Each morpheme's gloss by its place in the breakdown, so two occurrences of one repeated form
   * are edited apart. An entry of `''` records that the morpheme should carry no gloss, which no
   * donor may fill in.
   */
  morphemeGlosses?: Readonly<Record<number, string>>;
  confidence?: Edited<Confidence>;
}

/**
 * Carries the gloss edits typed against the breakdown `from` over to the forms of `to`, so an edit
 * stays on the form it was made about. An edit whose form `to` does not reach is dropped, there
 * being no morpheme left for it to be about, and a repeated form's occurrences stay distinct.
 */
export function remapMorphemeGlossEdits(
  glossEdits: Readonly<Record<number, string>> | undefined,
  from: readonly MorphemeAnalysis[],
  to: readonly string[],
): Readonly<Record<number, string>> | undefined {
  if (!glossEdits) return undefined;

  const editsOfForm = new Map<string, string[]>();
  from.forEach((m, index) => {
    const edit = glossEdits[index];
    if (edit === undefined) return;
    const bucket = editsOfForm.get(m.form);
    if (bucket) bucket.push(edit);
    else editsOfForm.set(m.form, [edit]);
  });

  const remapped: Record<number, string> = {};
  to.forEach((form, index) => {
    const edit = editsOfForm.get(form)?.shift();
    if (edit !== undefined) remapped[index] = edit;
  });
  return Object.keys(remapped).length > 0 ? remapped : undefined;
}

/** The state a merge panel derives its content from. */
export interface MergeContentInput {
  /** The analyses of the form, the survivor first — the order fallback reads down. */
  order: readonly CatalogRow[];
  /** Which analyses the merge would fold in, the survivor always among them. */
  checked: ReadonlySet<string>;
  edits: MergeContentEdits;
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
export interface MergeContentDerivation {
  /** The content the merge would write, which is what the editable fields are filled from. */
  content: MergedContentDraft;
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

/** Whether two references name one lexicon entry. */
function sameEntry(a: EntryRef | undefined, b: EntryRef | undefined): boolean {
  return (
    a !== undefined &&
    b !== undefined &&
    a.authority === b.authority &&
    a.projectId === b.projectId &&
    a.entryId === b.entryId
  );
}

/**
 * A row read as the stored analysis it stands for, so convergence is judged by the same rule the
 * store dedupes by rather than by a second definition of sameness that could drift from it.
 *
 * The id and timestamps are placeholders, sameness resting on content alone.
 */
function asAnalysis(
  content: Pick<CatalogRow, 'glosses' | 'glossSenseRef' | 'morphemes' | 'pos' | 'features'>,
  surfaceText: string,
): TokenAnalysis {
  return {
    id: '',
    createdAt: '',
    updatedAt: '',
    surfaceText,
    gloss: content.glosses,
    glossSenseRef: content.glossSenseRef,
    morphemes: [...content.morphemes],
    pos: content.pos,
    features: content.features ? { ...content.features } : undefined,
  };
}

/**
 * The glosses and sense the merge would leave the survivor holding: only the analysis language is
 * the reader's to settle, and what rides along untouched is what tells the survivor apart from a
 * record reading the same in the listed language.
 */
function settledGlossContent(
  content: MergedContentDraft,
  survivor: CatalogRow,
  donors: readonly CatalogRow[],
  analysisLanguage: string,
): Pick<CatalogRow, 'glosses' | 'glossSenseRef'> {
  const glosses: MultiString = {};
  [...donors].reverse().forEach((d) => Object.assign(glosses, d.glosses));
  Object.assign(glosses, survivor.glosses);

  if (content.gloss) glosses[analysisLanguage] = content.gloss;
  else delete glosses[analysisLanguage];

  return {
    glosses: Object.keys(glosses).length > 0 ? glosses : undefined,
    glossSenseRef: donors.find((d) => d.analysisId === content.glossFromAnalysisId)?.glossSenseRef,
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
 * The breakdown the checked analyses derive, before any re-split of the reader's stands over it.
 *
 * Taken whole rather than assembled morpheme by morpheme: a breakdown is one reading of the word,
 * and forms drawn from two of them would segment it a way no analysis actually claims.
 */
export function deriveBreakdown(
  order: readonly CatalogRow[],
  checked: ReadonlySet<string>,
): readonly MorphemeAnalysis[] {
  return (
    order
      .filter((r) => checked.has(r.analysisId))
      .map((r) => r.morphemes)
      .find((forms) => forms.length > 0) ?? []
  );
}

/**
 * Assembles the content a merge would write from the ordered analyses, the reader's edits over
 * them, and which analyses are being folded in.
 *
 * A field the survivor lacks is filled from the next analysis down that has one, which is why the
 * order is the reader's to arrange: it ranks the donors. Only analyses being folded in may donate —
 * one left unchecked survives on its own and has no business putting content into another record.
 */
export function deriveMergeContent({
  order,
  checked,
  edits,
  analysisLanguage,
  sourceLanguageTag,
}: MergeContentInput): MergeContentDerivation {
  const donors = order.filter((r) => checked.has(r.analysisId));

  /** The first donor's value for a field, the survivor's own coming first among them. */
  const donated = <T>(read: (r: CatalogRow) => T | undefined): T | undefined =>
    donors.map(read).find((value) => value !== undefined);

  const derivedBreakdown = deriveBreakdown(order, checked);

  // A breakdown edit supplies forms alone, so a form it leaves standing keeps the morpheme it had,
  // lexicon references and all, rather than being rebuilt as a bare form.
  const breakdown: readonly MorphemeAnalysis[] = edits.morphemeForms
    ? reconcileMorphemes(
        derivedBreakdown,
        edits.morphemeForms.map((form, index) => ({ id: `master-${index}`, form })),
        sourceLanguageTag,
      )
    : derivedBreakdown;

  /**
   * What the checked analyses say about each occurrence of each form, the highest-ranked donor's
   * first — keyed by the occurrence and not the form alone, so a repeated form's second occurrence
   * draws what a donor said about _its_ second, rather than an annotation already spoken for.
   */
  const donatedMorphemes = new Map<string, MorphemeAnalysis[]>();
  donors.forEach((r) => {
    const seenOfForm = new Map<string, number>();
    r.morphemes.forEach((m) => {
      const occurrence = seenOfForm.get(m.form) ?? 0;
      seenOfForm.set(m.form, occurrence + 1);
      const key = `${occurrence} ${m.form}`;
      const bucket = donatedMorphemes.get(key);
      if (bucket) bucket.push(m);
      else donatedMorphemes.set(key, [m]);
    });
  });

  /** The first donation of one morpheme field, the morpheme's own value coming first. */
  const donatedField = <T>(
    own: T | undefined,
    donations: readonly MorphemeAnalysis[],
    read: (m: MorphemeAnalysis) => T | undefined,
  ): T | undefined => own ?? donations.map(read).find((value) => value !== undefined);

  /**
   * A morpheme's lexicon references, always describing one entry: a sense, an allomorph and a
   * grammar reference are scoped by their entry, so drawn from whichever donor happened to define
   * each they would name parts of entries the morpheme does not resolve to.
   *
   * A morpheme resolving to no entry keeps its own references, which are all the merge can say when
   * nothing names an entry to scope them.
   */
  const donatedLexicon = (
    m: MorphemeAnalysis,
    donations: readonly MorphemeAnalysis[],
  ): Pick<MorphemeAnalysis, 'entryRef' | 'senseRef' | 'allomorphRef' | 'grammarRef'> => {
    const entryRef = donatedField(m.entryRef, donations, (d) => d.entryRef);
    if (entryRef === undefined)
      return {
        entryRef,
        senseRef: m.senseRef,
        allomorphRef: m.allomorphRef,
        grammarRef: m.grammarRef,
      };

    const ofEntry = sameEntry(m.entryRef, entryRef) ? m : undefined;
    const scoped = donations.filter((d) => sameEntry(d.entryRef, entryRef));
    return {
      entryRef,
      senseRef: donatedField(ofEntry?.senseRef, scoped, (d) => d.senseRef),
      allomorphRef: donatedField(ofEntry?.allomorphRef, scoped, (d) => d.allomorphRef),
      grammarRef: donatedField(ofEntry?.grammarRef, scoped, (d) => d.grammarRef),
    };
  };

  /** How many of each form the breakdown has reached, which picks the donation it draws. */
  const seenOfForm = new Map<string, number>();

  // Annotation fills in per morpheme, matched by form: unlike the segmentation, what a morpheme
  // means and what it resolves to in the lexicon is said of the morpheme itself, which a donor that
  // reached the same form is saying about the same thing. Only a morpheme still lacking a value
  // takes a donation, the reader's own edits outranking both.
  const morphemes = breakdown.map((m, index) => {
    const occurrence = seenOfForm.get(m.form) ?? 0;
    seenOfForm.set(m.form, occurrence + 1);
    const donations = donatedMorphemes.get(`${occurrence} ${m.form}`) ?? [];

    // Every tag but the analysis language settles here, that one alone being the reader's to edit.
    const otherGlosses: Record<string, string> = {};
    [...donations].reverse().forEach((d) => Object.assign(otherGlosses, d.gloss));
    Object.assign(otherGlosses, m.gloss);
    delete otherGlosses[analysisLanguage];

    const carried: MorphemeAnalysis = {
      ...m,
      ...donatedLexicon(m, donations),
      gloss: Object.keys(otherGlosses).length > 0 ? otherGlosses : undefined,
    };

    const settledGloss = donatedField(
      m.gloss?.[analysisLanguage],
      donations,
      (d) => d.gloss?.[analysisLanguage],
    );
    const gloss = edits.morphemeGlosses?.[index] ?? settledGloss;
    // An edit of `''` empties the gloss rather than leaving whatever the morpheme arrived carrying:
    // emptying one is a decision that it should carry none, which is what no gloss at all says.
    if (gloss === undefined || gloss === '') return carried;
    return { ...carried, gloss: { ...carried.gloss, [analysisLanguage]: gloss } };
  });

  /** One optional field's settled value: its edit where there is one, else what a donor gives. */
  const settled = <T>(edit: Edited<T> | undefined, read: (r: CatalogRow) => T | undefined) => {
    if (edit === CLEARED) return undefined;
    return edit ?? donated(read);
  };

  /** The highest-ranked donor carrying a gloss, which is the one an unedited merge settles on. */
  const glossDonor = donors.find((r) => r.gloss !== '');

  // An edit stands whatever the analyses say, a blank one included: emptying a field is a decision
  // about what the merge should write, not an absence for a lower analysis to fill.
  const gloss = edits.gloss ?? glossDonor?.gloss ?? '';

  const content: MergedContentDraft = {
    gloss,
    // Named only where a donor supplied the settled text: a gloss the reader composed resolves
    // through no lexicon sense of theirs.
    glossFromAnalysisId:
      edits.gloss === undefined && gloss !== '' ? glossDonor?.analysisId : undefined,
    morphemes,
    pos: donated((r) => r.pos),
    features: donated((r) => r.features),
    confidence: settled(edits.confidence, (r) => r.confidence),
  };

  const [survivor] = order;

  // Judged against what the merge would leave standing, so a record being folded in is not read as
  // a record the survivor is about to collide with.
  const written = asAnalysis(
    { ...content, ...settledGlossContent(content, survivor, donors, analysisLanguage) },
    survivor.surfaceText,
  );
  const collapsing = order.find(
    (r) =>
      !checked.has(r.analysisId) && analysesAreIdentical(written, asAnalysis(r, r.surfaceText)),
  );

  return { content, verdict: verdictFor(donors, collapsing?.analysisId) };
}
