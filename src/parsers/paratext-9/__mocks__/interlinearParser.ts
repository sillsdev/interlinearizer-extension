/**
 * @file Jest manual mock for parsers/paratext-9/interlinearParser. Placed adjacent to the module so
 * jest.mock('parsers/paratext-9/interlinearParser') picks it up automatically. Used by
 * interlinearizer.web-view tests so the WebView does not run real XML parsing.
 */

import type { InterlinearData } from '../types';

/** Stub InterlinearData returned by mockParse. Matches shape the WebView displays. */
export const stubInterlinearData: InterlinearData = {
  glossLanguage: 'en',
  bookId: 'JHN',
  verses: {},
};

export const mockParse = jest.fn().mockReturnValue(stubInterlinearData);

export const Paratext9Parser = jest.fn().mockImplementation(() => ({
  parse: mockParse,
}));
