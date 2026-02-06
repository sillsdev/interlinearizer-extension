/**
 * Jest mock for stylesheet imports (CSS, SCSS, SASS). Used so that `import './foo.scss'` and
 * similar do not run real style loaders in tests. Mirrors webpack's handling of .(sa|sc|c)ss in
 * webpack.config.base (we mock instead of compile).
 *
 * @see https://jestjs.io/docs/webpack#handling-static-assets
 */
module.exports = {};
