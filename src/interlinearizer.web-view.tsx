import { useMemo, useState } from 'react';
import type { InterlinearData } from 'paratext-9-types';
import { Paratext9Parser } from './parsers/paratext-9/paratext9Parser';
import { convertParatext9ToInterlinearization } from './parsers/paratext-9/paratext9Converter';

/** Test interlinear XML bundled at build time (from test-data/Interlinear_en_MAT.xml). */
import testXml from '../test-data/Interlinear_en_MAT.xml?raw';

/** Result of parsing the bundled test XML: either data or an error message. */
type ParseResult = { data: InterlinearData; error: undefined } | { data: undefined; error: string };

/** View mode for the JSON display: raw PT9 structure or converted interlinearizer model. */
type JsonViewMode = 'interlinear-data' | 'interlinearization';

/**
 * Main interlinearizer WebView. Parses the bundled test XML into the interlinear model and displays
 * the result as raw JSON. No PAPI commands or file loading—everything is self-contained.
 *
 * A switch lets the user choose between viewing {@link InterlinearData} (Paratext 9 format) or
 * {@link Interlinearization} (converted interlinearizer model). Parser is created inside useMemo so
 * parsing runs once per mount.
 */
globalThis.webViewComponent = function InterlinearizerWebView() {
  const [jsonViewMode, setJsonViewMode] = useState<JsonViewMode>('interlinear-data');

  const { data: parsed, error: parseError } = useMemo((): ParseResult => {
    const parser = new Paratext9Parser();
    try {
      const data = parser.parse(testXml);
      return { data, error: undefined };
    } catch (err) {
      return { data: undefined, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const interlinearization = useMemo(
    () => (parsed ? convertParatext9ToInterlinearization(parsed) : undefined),
    [parsed],
  );

  /** In Interlinearization mode use converted data (may be undefined); otherwise use parsed. */
  const jsonToShow = jsonViewMode === 'interlinearization' ? interlinearization : parsed;

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
            <span className="tw-text-sm tw-font-medium tw-text-foreground">View JSON as:</span>
            <div
              className="tw-inline-flex tw-rounded-md tw-border tw-border-border tw-bg-muted tw-p-0.5"
              role="group"
              aria-label="JSON view mode"
            >
              <button
                type="button"
                onClick={() => setJsonViewMode('interlinear-data')}
                className={`tw-rounded tw-px-3 tw-py-1.5 tw-text-sm tw-font-medium tw-transition-colors ${
                  jsonViewMode === 'interlinear-data'
                    ? 'tw-bg-background tw-text-foreground tw-shadow-sm'
                    : 'tw-text-muted-foreground hover:tw-text-foreground'
                }`}
                aria-pressed={jsonViewMode === 'interlinear-data'}
              >
                InterlinearData
              </button>
              <button
                type="button"
                onClick={() => setJsonViewMode('interlinearization')}
                className={`tw-rounded tw-px-3 tw-py-1.5 tw-text-sm tw-font-medium tw-transition-colors ${
                  jsonViewMode === 'interlinearization'
                    ? 'tw-bg-background tw-text-foreground tw-shadow-sm'
                    : 'tw-text-muted-foreground hover:tw-text-foreground'
                }`}
                aria-pressed={jsonViewMode === 'interlinearization'}
              >
                Interlinearization
              </button>
            </div>
            <p className="tw-text-xs tw-text-muted-foreground">
              {jsonViewMode === 'interlinear-data'
                ? 'Paratext 9 book/verse/cluster structure.'
                : 'Converted interlinearizer book/segment/occurrence model.'}
            </p>
          </div>
          <p className="tw-text-sm tw-text-muted-foreground">
            {jsonViewMode === 'interlinear-data'
              ? 'InterlinearData (JSON):'
              : 'Interlinearization (JSON):'}
          </p>
          <pre className="tw-overflow-auto tw-rounded-md tw-border tw-border-border tw-bg-muted tw-p-4 tw-text-sm tw-font-mono tw-leading-relaxed">
            {jsonToShow ? JSON.stringify(jsonToShow, undefined, 2) : ''}
          </pre>
        </>
      )}
    </div>
  );
};
