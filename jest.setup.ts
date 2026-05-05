/**
 * Jest setup file. Runs before each test file. Extends expect with @testing-library/jest-dom
 * matchers for React component tests.
 */
import '@testing-library/jest-dom';

function ResizeObserverMock(): void {}

ResizeObserverMock.prototype.observe = function observe(): void {};
ResizeObserverMock.prototype.unobserve = function unobserve(): void {};
ResizeObserverMock.prototype.disconnect = function disconnect(): void {};

if (!global.ResizeObserver) {
  Object.defineProperty(global, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });
}
