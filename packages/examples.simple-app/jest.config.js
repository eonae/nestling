export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        target: 'es2022',
        useDefineForClassFields: true,
        experimentalDecorators: false,
        emitDecoratorMetadata: false
      }
    }]
  },
  moduleNameMapper: {
    '^lodash-es$': 'lodash'
  }
};
