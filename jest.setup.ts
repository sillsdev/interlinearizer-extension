/**
 * Jest setup file. Runs before each test file. Extends expect with @testing-library/jest-dom
 * matchers for React component tests.
 */
import '@testing-library/jest-dom';

// jsdom does no layout, so it lacks the caret hit-test. This stub reports that every point misses
// text; a test that needs a hit defines `caretPositionFromPoint` on `document` itself.
// eslint-disable-next-line no-null/no-null -- the DOM API reports no hit as null
Document.prototype.caretPositionFromPoint = () => null;
