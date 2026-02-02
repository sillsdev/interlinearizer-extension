import { useMemo } from 'react';
import type { InterlinearData } from 'paranext-extension-template';
import { InterlinearXmlParser } from './parsers/interlinearXmlParser';

/** Test interlinear XML bundled at build time (from test-data/Interlinear_en_MAT.xml). */
import testXml from '../test-data/Interlinear_en_MAT.xml?raw';

const parser = new InterlinearXmlParser();

/** Result of parsing the bundled test XML: either data or an error message. */
type ParseResult = { data: InterlinearData; error: undefined } | { data: undefined; error: string };

/**
 * Main interlinearizer WebView. Parses the bundled test XML into the interlinear model and displays
 * the result as raw JSON. No PAPI commands or file loading—everything is self-contained.
 */
globalThis.webViewComponent = function InterlinearizerWebView() {
  const { data: parsed, error: parseError } = useMemo((): ParseResult => {
    try {
      const data = parser.parse(testXml);
      return { data, error: undefined };
    } catch (err) {
      return {
        data: undefined,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, []);

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

      {parsed && !parseError && (
        <>
          <p className="tw-text-sm tw-text-muted-foreground">Parsed interlinear data (JSON):</p>
          <pre className="tw-overflow-auto tw-rounded-md tw-border tw-border-border tw-bg-muted tw-p-4 tw-text-sm tw-font-mono tw-leading-relaxed">
            {JSON.stringify(parsed, undefined, 2)}
          </pre>
        </>
      )}
    </div>
  );
};
