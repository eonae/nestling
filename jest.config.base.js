import { fileURLToPath } from 'url';
import { dirname } from 'path';

/**
 * Базовая конфигурация Jest для всех пакетов
 */
export function createJestConfig(fileUrl) {
  const __filename = fileURLToPath(fileUrl);
  const rootDir = dirname(__filename);

  return {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    rootDir,
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
      '^.+\\.ts$': [
        'ts-jest',
        {
          useESM: true,
          tsconfig: {
            target: 'es2022',
            useDefineForClassFields: true,
            experimentalDecorators: false,
            emitDecoratorMetadata: false,
          },
        },
      ],
    },
    moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
      '^lodash-es$': 'lodash',
      // Маппинг всех workspace пакетов на исходники
      '^@nestling/(.*)$': '<rootDir>/../nestling.$1/src/index.ts',
      '^@common/(.*)$': '<rootDir>/../common.$1/src/index.ts',
    },
  };
}
