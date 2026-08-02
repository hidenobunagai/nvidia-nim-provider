/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
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
