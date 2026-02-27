import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { InterlinearData } from 'parsers/paratext-9/types';
import { Paratext9Parser } from 'parsers/paratext-9/interlinearParser';
import {
  convertParatext9ToInterlinearAlignment,
  createSourceAnalyses,
  createTargetAnalyses,
} from 'parsers/paratext-9/converter';
import { parseLexicon, buildGlossLookupFromLexicon } from 'parsers/paratext-9/lexiconParser';

import type { InterlinearAlignment, Segment, Occurrence, Analysis } from 'interlinearizer';
import { OccurrenceType, AnalysisType } from 'types/interlinearizer-enums';
/** Test interlinear XML bundled at build time (from test-data/Interlinear_en_JHN.xml). */
import testXml from '../test-data/Interlinear_en_JHN.xml?raw';
/**
 * Lexicon XML for gloss text lookup (test-data/Lexicon.xml). Parsed once; on failure we use no
 * glossary.
 */
import lexiconXml from '../test-data/Lexicon.xml?raw';

/** Result of parsing the bundled test XML: either data or an error message. */
type ParseResult = { data: InterlinearData; error: undefined } | { data: undefined; error: string };

/** View mode: raw PT9, converted model, analyses map, or rendered interlinear. */
export type JsonViewMode = 'interlinear-data' | 'interlinearization' | 'analyses' | 'interlinear';

/**
 * Sentinel returned by jsonToShow when interlinearization mode is selected but conversion is still
 * in progress.
 */
export const JSON_SHOW_CONVERTING = Symbol('JSON_SHOW_CONVERTING');

/** Ordered list of view modes for rendering and arrow-key navigation. */
const JSON_VIEW_MODES: { key: JsonViewMode; label: string }[] = [
  { key: 'interlinear', label: 'Interlinear' },
  { key: 'interlinear-data', label: 'InterlinearData' },
  { key: 'interlinearization', label: 'Interlinearization' },
  { key: 'analyses', label: 'Analyses' },
];

/** Returns the description for the view mode. */
function getViewModeDescription(mode: JsonViewMode): string {
  if (mode === 'interlinear')
    return 'Rendered verse-by-verse: source morphs (above source), source text, gloss, and analyses (morpheme glosses below gloss when present).';
  if (mode === 'interlinear-data') return 'Paratext 9 book/verse/cluster structure.';
  if (mode === 'interlinearization')
    return 'Converted interlinearizer book/segment/occurrence model.';
  return 'Analysis objects (ID → gloss, confidence, source) from test data.';
}

/** Returns the label for the view mode. */
function getViewModeLabel(mode: JsonViewMode): string {
  if (mode === 'interlinear') return 'Interlinear (rendered):';
  if (mode === 'interlinear-data') return 'InterlinearData (JSON):';
  if (mode === 'interlinearization') return 'Interlinearization (JSON):';
  return 'Analyses (JSON):';
}

/** Renders jsonToShow for the <pre>: "Converting…" for sentinel, stringified JSON, or empty string. */
function formatJsonPreContent(jsonToShow: unknown): string {
  if (jsonToShow === JSON_SHOW_CONVERTING) return 'Converting...';
  if (jsonToShow !== undefined) return JSON.stringify(jsonToShow, undefined, 2);
  return '';
}

/** Props for the rendered interlinear view (verse-by-verse source + target). */
interface InterlinearDisplayProps {
  /** Source and target interlinearizations (from convertParatext9ToInterlinearAlignment). */
  alignment: InterlinearAlignment | undefined;
  /** True while conversion is in progress. */
  converting: boolean;
  /** Source analysis ID → Analysis (morph forms for Source morphs row). */
  sourceAnalysesMap: Map<string, Analysis> | undefined;
  /** Target analysis ID → Analysis (gloss text for Analyses row). */
  targetAnalysesMap: Map<string, Analysis> | undefined;
}

/**
 * Morph-level glosses for an occurrence (for Analyses row). Only assignments whose analysis is
 * Morph type; glossText from target analyses.
 */
function getMorphGlosses(occ: Occurrence, analysesMap: Map<string, Analysis>): string[] {
  return occ.assignments
    .map((a) => {
      const analysis = analysesMap.get(a.analysisId);
      return analysis?.analysisType === AnalysisType.Morph ? (analysis.glossText ?? '') : '';
    })
    .filter((t) => t.length > 0);
}

/**
 * Resolves source morph forms for an occurrence (morpheme-level analyses only). Used for the
 * "Source morphs" row above the source text, mirroring how target morph glosses appear below
 * gloss.
 *
 * @param occ - Occurrence with assignments.
 * @param analysesMap - Analysis ID → Analysis.
 * @returns Ordered list of source forms (one per morph analysis; from morphemeBundles[].form).
 */
function getSourceMorphForms(occ: Occurrence, analysesMap: Map<string, Analysis>): string[] {
  return occ.assignments
    .map((a) => {
      const analysis = analysesMap.get(a.analysisId);
      if (analysis?.analysisType !== AnalysisType.Morph || !analysis.morphemeBundles?.length)
        return undefined;
      return analysis.morphemeBundles[0].form;
    })
    .filter((f): f is string => typeof f === 'string' && f.length > 0);
}

const LINE_LABEL_CLASS =
  'tw-text-[10px] tw-uppercase tw-tracking-wide tw-text-muted-foreground/70 tw-shrink-0 tw-min-w-[5.5rem]';

/**
 * Renders a segment pair (source + target) as four labeled rows: Source morphs and Source from
 * source interlinearization; Gloss and Analyses from target (occurrence.surfaceText = word-level
 * gloss, morph analyses = Analyses row). One column per occurrence; labels align left.
 */
function SegmentBlock({
  sourceSegment,
  targetSegment,
  sourceAnalysesMap,
  targetAnalysesMap,
}: {
  sourceSegment: Segment;
  targetSegment: Segment;
  sourceAnalysesMap: Map<string, Analysis>;
  targetAnalysesMap: Map<string, Analysis>;
}) {
  const n = sourceSegment.occurrences.length;
  const gridCols = `minmax(5.5rem, max-content) repeat(${n}, minmax(0, max-content))`;
  const cellClass = 'tw-text-left';
  return (
    <div
      className="tw-flex tw-flex-col tw-gap-0.5 tw-rounded tw-border tw-border-border tw-bg-muted/40 tw-p-3 tw-text-left"
      dir="ltr"
    >
      <div className="tw-text-xs tw-font-medium tw-text-muted-foreground tw-mb-1">
        {sourceSegment.segmentRef}
      </div>
      <div
        className="tw-grid tw-gap-x-3 tw-gap-y-0.5 tw-text-sm tw-items-baseline tw-justify-items-start tw-justify-content-start"
        style={{ gridTemplateColumns: gridCols }}
      >
        <span className={LINE_LABEL_CLASS}>Source morphs</span>
        {sourceSegment.occurrences.map((occ) => {
          const sourceMorphs = getSourceMorphForms(occ, sourceAnalysesMap);
          const sourceMorphsLine =
            occ.type === OccurrenceType.Word && sourceMorphs.length > 0
              ? sourceMorphs.join(' ')
              : '';
          return (
            <span
              key={occ.id}
              className={`tw-text-xs tw-text-muted-foreground/80 tw-italic ${cellClass}`}
              title={occ.anchor}
            >
              {sourceMorphsLine}
            </span>
          );
        })}
        <span className={LINE_LABEL_CLASS}>Source</span>
        {sourceSegment.occurrences.map((occ) => (
          <span
            key={occ.id}
            className={`tw-font-medium tw-text-foreground ${cellClass}`}
            title={occ.anchor}
          >
            {occ.type === OccurrenceType.Punctuation
              ? occ.surfaceText || '—'
              : occ.surfaceText || '·'}
          </span>
        ))}
        <span className={LINE_LABEL_CLASS}>Gloss</span>
        {targetSegment.occurrences.map((occ) => (
          <span key={occ.id} className={`tw-text-muted-foreground ${cellClass}`} title={occ.anchor}>
            {occ.type === OccurrenceType.Punctuation
              ? occ.surfaceText || ''
              : occ.surfaceText || '—'}
          </span>
        ))}
        <span className={LINE_LABEL_CLASS}>Analyses</span>
        {targetSegment.occurrences.map((occ) => {
          const morphGlosses = getMorphGlosses(occ, targetAnalysesMap);
          const analysesLine =
            occ.type === OccurrenceType.Word && morphGlosses.length > 0
              ? morphGlosses.join(' ')
              : '';
          return (
            <span
              key={occ.id}
              className={`tw-text-xs tw-text-muted-foreground/80 tw-italic ${cellClass}`}
              title={occ.anchor}
            >
              {analysesLine}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Displays the interlinear alignment: one block per verse with source (morphs + surface) and target
 * (gloss = occurrence.surfaceText, analyses = morph glosses).
 */
function InterlinearDisplay({
  alignment,
  converting,
  sourceAnalysesMap,
  targetAnalysesMap,
}: InterlinearDisplayProps) {
  if (converting) {
    return <p className="tw-text-sm tw-text-muted-foreground">Converting Paratext 9 data…</p>;
  }
  if (!alignment || !sourceAnalysesMap || !targetAnalysesMap) {
    return (
      <p className="tw-text-sm tw-text-muted-foreground">No alignment or analyses available.</p>
    );
  }
  const { source, target } = alignment;
  return (
    <div className="tw-flex tw-flex-col tw-gap-3 tw-overflow-auto">
      {source.books.map((book, bookIdx) => {
        const targetBook = target.books[bookIdx];
        if (!targetBook) return undefined;
        return (
          <section key={book.id} className="tw-flex tw-flex-col tw-gap-2">
            <h2 className="tw-text-base tw-font-semibold tw-text-foreground">{book.bookRef}</h2>
            {book.segments.map((sourceSegment, segIdx) => {
              const targetSegment = targetBook.segments[segIdx];
              if (!targetSegment) return undefined;
              return (
                <SegmentBlock
                  key={sourceSegment.id}
                  sourceSegment={sourceSegment}
                  targetSegment={targetSegment}
                  sourceAnalysesMap={sourceAnalysesMap}
                  targetAnalysesMap={targetAnalysesMap}
                />
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Pure handler for arrow-key navigation on the JSON view mode radiogroup. Left/Up select previous,
 * Right/Down select next. Exported for unit testing.
 *
 * @param currentMode - Current JSON view mode as string (must be in {@link JSON_VIEW_MODES} or
 *   no-op).
 * @param eventKey - KeyboardEvent.key (e.g. 'ArrowRight', 'ArrowLeft').
 * @param setJsonViewMode - State setter for view mode.
 * @param focusRadio - Callback to focus the radio for a given mode (e.g.
 *   refs.current[key]?.focus()).
 * @returns True if the key was handled (caller should call event.preventDefault()).
 */
export function handleJsonViewModeKeyDown(
  currentMode: string,
  eventKey: string,
  setJsonViewMode: (mode: JsonViewMode) => void,
  focusRadio: (mode: JsonViewMode) => void,
): boolean {
  const idx = JSON_VIEW_MODES.findIndex((m) => m.key === currentMode);
  if (idx === -1) return false;
  if (eventKey === 'ArrowRight' || eventKey === 'ArrowDown') {
    const nextKey = JSON_VIEW_MODES[(idx + 1) % JSON_VIEW_MODES.length].key;
    setJsonViewMode(nextKey);
    focusRadio(nextKey);
    return true;
  }
  if (eventKey === 'ArrowLeft' || eventKey === 'ArrowUp') {
    const nextKey =
      JSON_VIEW_MODES[(idx - 1 + JSON_VIEW_MODES.length) % JSON_VIEW_MODES.length].key;
    setJsonViewMode(nextKey);
    focusRadio(nextKey);
    return true;
  }
  return false;
}

/**
 * Main interlinearizer WebView. Parses the bundled test XML into the interlinear model and displays
 * the result as raw JSON. No PAPI commands or file loading—everything is self-contained.
 *
 * A switch lets the user choose between: {@link InterlinearData} (Paratext 9 format),
 * {@link Interlinearization} (converted interlinearizer model), or Analyses (ID → Analysis map
 * derived from test data: gloss, confidence, source). Parser is created inside useMemo so parsing
 * runs once per mount.
 */
globalThis.webViewComponent = function InterlinearizerWebView() {
  const [jsonViewMode, setJsonViewMode] = useState<JsonViewMode>('interlinear-data');

  /** Refs to each radio button for moving focus on arrow-key navigation. */
  const radioRefs = useRef<Record<JsonViewMode, HTMLButtonElement | undefined>>({
    interlinear: undefined,
    'interlinear-data': undefined,
    interlinearization: undefined,
    analyses: undefined,
  });

  /** Wires arrow-key events to the pure handler and prevents default when handled. */
  const onJsonViewModeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      handleJsonViewModeKeyDown(jsonViewMode, e.key, setJsonViewMode, (key) =>
        radioRefs.current[key]?.focus(),
      )
    ) {
      e.preventDefault();
    }
  };

  const { data: parsed, error: parseError } = useMemo((): ParseResult => {
    const parser = new Paratext9Parser();
    try {
      const data = parser.parse(testXml);
      return { data, error: undefined };
    } catch (err) {
      return { data: undefined, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const [alignment, setAlignment] = useState<InterlinearAlignment | undefined>();
  /**
   * True once the convert promise has resolved or rejected; used to show "Converting…" only while
   * in flight.
   */
  const [conversionSettled, setConversionSettled] = useState(false);

  /** Parsed Lexicon (PT9-aligned). Built once; invalid Lexicon is ignored. */
  const lexiconData = useMemo(() => {
    try {
      return parseLexicon(lexiconXml);
    } catch {
      return undefined;
    }
  }, []);

  /** Gloss lookup (senseId, language) → text for target analyses. */
  const glossLookup = useMemo(
    () => (lexiconData ? buildGlossLookupFromLexicon(lexiconData) : undefined),
    [lexiconData],
  );

  useEffect(() => {
    if (!parsed) {
      setAlignment(undefined);
      setConversionSettled(false);
      return;
    }
    setConversionSettled(false);
    let cancelled = false;
    convertParatext9ToInterlinearAlignment(parsed, lexiconData ?? undefined)
      .then((result) => {
        if (!cancelled) {
          setAlignment(result);
          setConversionSettled(true);
        }
        return undefined;
      })
      .catch(() => {
        if (!cancelled) {
          setAlignment(undefined);
          setConversionSettled(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [parsed, lexiconData]);

  /** Source analyses (morph forms for Source morphs row). */
  const sourceAnalysesMap = useMemo(
    () => (parsed ? createSourceAnalyses(parsed) : undefined),
    [parsed],
  );
  /** Target analyses (gloss text for Analyses row). */
  const targetAnalysesMap = useMemo(
    () => (parsed ? createTargetAnalyses(parsed, { glossLookup }) : undefined),
    [parsed, glossLookup],
  );

  /**
   * Data to show as JSON: depends on selected view mode. Shows converting sentinel when in
   * interlinearization mode and conversion has not yet settled (promise still in flight).
   */
  const jsonToShow = useMemo((): unknown => {
    if (jsonViewMode === 'interlinearization') {
      if (alignment === undefined && !conversionSettled) return JSON_SHOW_CONVERTING;
      return alignment;
    }
    if (jsonViewMode === 'analyses') {
      if (!sourceAnalysesMap || !targetAnalysesMap) return undefined;
      return {
        source: Object.fromEntries(sourceAnalysesMap),
        target: Object.fromEntries(targetAnalysesMap),
      };
    }
    return parsed;
  }, [jsonViewMode, parsed, alignment, conversionSettled, sourceAnalysesMap, targetAnalysesMap]);

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-p-6">
      <h1 className="tw-text-2xl tw-font-semibold tw-tracking-tight">Interlinearizer</h1>
      <p className="tw-text-sm tw-text-muted-foreground">
        Raw JSON of the model parsed from <code>test-data/Interlinear_en_JHN.xml</code>.
      </p>

      {parseError && (
        <div className="tw-flex tw-flex-col tw-gap-2">
          <h2 className="tw-text-lg tw-font-medium tw-text-destructive">Parse error</h2>
          <pre className="tw-overflow-auto tw-rounded-md tw-bg-muted tw-p-4 tw-text-sm tw-text-muted-foreground">
            {parseError}
          </pre>
        </div>
      )}

      {parsed && (
        <>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
            <span
              id="interlinearizer-json-view-mode-label"
              className="tw-text-sm tw-font-medium tw-text-foreground"
            >
              View JSON as:
            </span>
            <div
              className="tw-inline-flex tw-rounded-md tw-border tw-border-border tw-bg-muted tw-p-0.5"
              role="radiogroup"
              aria-labelledby="interlinearizer-json-view-mode-label"
              tabIndex={-1}
              onKeyDown={onJsonViewModeKeyDown}
            >
              {JSON_VIEW_MODES.map(({ key, label }) => (
                <button
                  key={key}
                  ref={(el) => {
                    radioRefs.current[key] = el ?? undefined;
                  }}
                  type="button"
                  role="radio"
                  tabIndex={jsonViewMode === key ? 0 : -1}
                  aria-checked={jsonViewMode === key}
                  onClick={() => setJsonViewMode(key)}
                  className={`tw-rounded tw-px-3 tw-py-1.5 tw-text-sm tw-font-medium tw-transition-colors ${
                    jsonViewMode === key
                      ? 'tw-bg-background tw-text-foreground tw-shadow-sm'
                      : 'tw-text-muted-foreground hover:tw-text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="tw-text-xs tw-text-muted-foreground">
              {getViewModeDescription(jsonViewMode)}
            </p>
          </div>
          <p className="tw-text-sm tw-text-muted-foreground">{getViewModeLabel(jsonViewMode)}</p>
          {jsonViewMode === 'interlinear' ? (
            <InterlinearDisplay
              alignment={alignment}
              converting={!conversionSettled && alignment === undefined}
              sourceAnalysesMap={sourceAnalysesMap}
              targetAnalysesMap={targetAnalysesMap}
            />
          ) : (
            <pre className="tw-overflow-auto tw-rounded-md tw-border tw-border-border tw-bg-muted tw-p-4 tw-text-sm tw-font-mono tw-leading-relaxed">
              {formatJsonPreContent(jsonToShow)}
            </pre>
          )}
        </>
      )}
    </div>
  );
};
