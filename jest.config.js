/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // tests finds the suites; src lets Jest's haste map see src/**/*.ts so
  // collectCoverageFrom can report a module no test imports yet at 0%, instead of
  // silently leaving it out of the report (CoverageReporter._addUntestedFiles walks
  // context.hasteFS, which `roots` scopes).
  roots: ["<rootDir>/tests", "<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js"],
  collectCoverageFrom: ["src/**/*.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  coverageThreshold: {
    global: {
      lines: 50,
      branches: 50,
      functions: 50,
      statements: 50,
    },
  },
  moduleNameMapper: {
    "^vscode$": "<rootDir>/__mocks__/vscode.ts",
    "^../package.json$": "<rootDir>/package.json",
  },
};
