/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // tests finds the suites; src and scripts let Jest's haste map see their files so
  // collectCoverageFrom can report a module no test imports yet at 0%, instead of
  // silently leaving it out of the report (CoverageReporter._addUntestedFiles walks
  // context.hasteFS, which `roots` scopes).
  roots: ["<rootDir>/tests", "<rootDir>/src", "<rootDir>/scripts"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js"],
  // scripts/ is here because CI runs `bun run sync:pi` too: leaving it out meant the
  // one file that command executes was the one file no coverage report named.
  collectCoverageFrom: ["src/**/*.ts", "scripts/**/*.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  coverageThreshold: {
    global: {
      lines: 75,
      branches: 60,
      functions: 75,
      statements: 75,
    },
  },
  moduleNameMapper: {
    "^vscode$": "<rootDir>/__mocks__/vscode.ts",
    "^../package.json$": "<rootDir>/package.json",
  },
};
