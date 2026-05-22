// Jest setup file. Runs before each test file. Extends expect with @testing-library/jest-dom
// matchers for React component tests.
// .js rather than .ts: Jest validates setupFilesAfterEnv paths via require.resolve before
// ts-jest's transform hooks are registered, so .ts paths can fail to resolve on Windows.
require('@testing-library/jest-dom');
