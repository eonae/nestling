import { createJestConfig } from '../../jest.config.base.js';

export default createJestConfig(import.meta.url, {
  displayName: 'examples.app-with-http:e2e',
  testMatch: ['**/e2e/**/*.spec.e2e.ts'],
  testTimeout: 60_000,
  // Каждый файл поднимает своё приложение на порту 0; прогон последовательный
  maxWorkers: 1,
});
