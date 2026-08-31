import { createJestConfig } from '../../jest.config.base.js';

export default createJestConfig(import.meta.url, {
  displayName: 'examples.app-with-http:e2e',
  testMatch: ['**/e2e/**/*.spec.e2e.ts'],
  testTimeout: 60_000, // 1 минута на тест
  maxWorkers: 1, // Последовательное выполнение

  globalSetup: '<rootDir>/e2e/setup.ts',
  globalTeardown: '<rootDir>/e2e/teardown.ts',
});
