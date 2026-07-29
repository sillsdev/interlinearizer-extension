/**
 * @file Jest mock for stylesheet imports (CSS, SCSS, SASS). Used so that `import './foo.scss'` and
 * similar do not run real style loaders in tests. Returns an empty string because webpack's
 * css-loader is configured to export stylesheets as plain CSS strings, which main.ts hands to the
 * WebView definition.
 *
 * @see https://jestjs.io/docs/webpack#handling-static-assets
 */
module.exports = '';
