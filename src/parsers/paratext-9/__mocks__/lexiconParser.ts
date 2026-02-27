/**
 * @file Jest manual mock for parsers/paratext-9/lexiconParser. Placed adjacent to the module so
 * jest.mock('parsers/paratext-9/lexiconParser') picks it up automatically. Used by
 * interlinearizer.web-view tests so the WebView does not run real conversion.
 */

import { LexiconData } from "../types";

/** Stub lookup: (senseId, language) => undefined. Matches LexiconGlossLookup shape. */
const stubGlossLookup = (_senseId: string, _language: string): string | undefined => undefined;

/** Minimal LexiconData so the webview can call buildGlossLookupFromLexicon(lexiconData). */
const stubLexiconData: LexiconData = { language: 'en', fontName: '', fontSize: 0, entries: {} };

export const parseLexicon = jest.fn().mockReturnValue(stubLexiconData);
export const buildGlossLookupFromLexicon = jest.fn().mockReturnValue(stubGlossLookup);
export const parseLexiconAndBuildGlossLookup = jest.fn().mockReturnValue(stubGlossLookup);
