/**
 * Jest mock for static asset imports (images, fonts, etc.). Importing e.g. `logo.png` in tests will
 * receive this string instead of running file loaders. Mirrors webpack's asset/inline and
 * asset/resource handling in webpack.config.base.
 *
 * @see https://jestjs.io/docs/webpack#handling-static-assets
 */
module.exports = 'test-file-stub';
