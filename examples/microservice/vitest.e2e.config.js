import { createVitestConfig } from '../../vitest.config.base.js';

export default createVitestConfig(import.meta.url, {
  name: '@examples/microservice:e2e',
  include: ['e2e/**/*.spec.e2e.ts'],
  testTimeout: 60_000,
  // Каждый файл поднимает своё приложение на порту 0; прогон последовательный
  fileParallelism: false,
});
