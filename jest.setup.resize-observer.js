// jsdom does not implement ResizeObserver; stub it so hooks that use it don't throw.
// Plain JS to avoid TypeScript/ESLint restrictions on type assertions and class rules.
global.ResizeObserver = function ResizeObserver() {
  return { observe() {}, unobserve() {}, disconnect() {} };
};
