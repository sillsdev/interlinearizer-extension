import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { InterlinearData } from 'parsers/paratext-9/paratext-9-types';
import { Paratext9Parser } from 'parsers/paratext-9/paratext9Parser';
import {
  convertParatext9ToInterlinearization,
  createAnalyses,
} from 'parsers/paratext-9/paratext9Converter';
import { parseLexiconAndBuildGlossLookup } from 'parsers/paratext-9/lexiconParser';

import type { Interlinearization } from 'interlinearizer';
/** Test interlinear XML bundled at build time (from test-data/Interlinear_en_MAT.xml). */
import testXml from '../test-data/Interlinear_en_MAT.xml?raw';
/**
 * Lexicon XML for gloss text lookup (test-data/Lexicon.xml). Parsed once; on failure we use no
 * glossary.
 */
import lexiconXml from '../test-data/Lexicon.xml?raw';

/** Result of parsing the bundled test XML: either data or an error message. */
type ParseResult = { data: InterlinearData; error: undefined } | { data: undefined; error: string };

/** View mode for the JSON display: raw PT9, converted model, or analyses map. */
export type JsonViewMode = 'interlinear-data' | 'interlinearization' | 'analyses';

/**
 * Sentinel returned by jsonToShow when interlinearization mode is selected but conversion is still
 * in progress.
 */
export const JSON_SHOW_CONVERTING = Symbol('JSON_SHOW_CONVERTING');

/** Ordered list of JSON view modes for rendering and arrow-key navigation. */
const JSON_VIEW_MODES: { key: JsonViewMode; label: string }[] = [
  { key: 'interlinear-data', label: 'InterlinearData' },
  { key: 'interlinearization', label: 'Interlinearization' },
  { key: 'analyses', label: 'Analyses' },
];

function getViewModeDescription(mode: JsonViewMode): string {
  if (mode === 'interlinear-data') return 'Paratext 9 book/verse/cluster structure.';
  if (mode === 'interlinearization')
    return 'Converted interlinearizer book/segment/occurrence model.';
  return 'Analysis objects (ID → gloss, confidence, source) from test data.';
}

function getViewModeLabel(mode: JsonViewMode): string {
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

  const [interlinearization, setInterlinearization] = useState<Interlinearization | undefined>();
  /**
   * True once the convert promise has resolved or rejected; used to show "Converting…" only while
   * in flight.
   */
  const [conversionSettled, setConversionSettled] = useState(false);

  useEffect(() => {
    if (!parsed) {
      setInterlinearization(undefined);
      setConversionSettled(false);
      return;
    }
    setConversionSettled(false);
    let cancelled = false;
    convertParatext9ToInterlinearization(parsed)
      .then((result) => {
        if (!cancelled) {
          setInterlinearization(result);
          setConversionSettled(true);
        }
        return undefined;
      })
      .catch(() => {
        if (!cancelled) {
          setInterlinearization(undefined);
          setConversionSettled(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [parsed]);

  /** Gloss lookup from Lexicon (senseId, language) → text. Built once; invalid Lexicon is ignored. */
  const glossLookup = useMemo(() => {
    try {
      return parseLexiconAndBuildGlossLookup(lexiconXml);
    } catch {
      return undefined;
    }
  }, []);

  /** Analyses map derived from parsed data (ID → Analysis); only defined when parsed exists. */
  const analysesMap = useMemo(
    () => (parsed ? createAnalyses(parsed, { glossLookup }) : undefined),
    [parsed, glossLookup],
  );

  /**
   * Data to show as JSON: depends on selected view mode. Shows converting sentinel when in
   * interlinearization mode and conversion has not yet settled (promise still in flight).
   */
  const jsonToShow = useMemo((): unknown => {
    if (jsonViewMode === 'interlinearization') {
      if (interlinearization === undefined && !conversionSettled) return JSON_SHOW_CONVERTING;
      return interlinearization;
    }
    if (jsonViewMode === 'analyses')
      return analysesMap ? Object.fromEntries(analysesMap) : undefined;
    return parsed;
  }, [jsonViewMode, parsed, interlinearization, conversionSettled, analysesMap]);

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-p-6">
      <h1 className="tw-text-2xl tw-font-semibold tw-tracking-tight">Interlinearizer</h1>
      <p className="tw-text-sm tw-text-muted-foreground">
        Raw JSON of the model parsed from <code>test-data/Interlinear_en_MAT.xml</code>.
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
          <pre className="tw-overflow-auto tw-rounded-md tw-border tw-border-border tw-bg-muted tw-p-4 tw-text-sm tw-font-mono tw-leading-relaxed">
            {formatJsonPreContent(jsonToShow)}
          </pre>
        </>
      )}
    </div>
  );
};
