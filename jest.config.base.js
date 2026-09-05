import { fileURLToPath } from 'url';
import { dirname } from 'path';

/**
 * Базовая конфигурация Jest для всех пакетов
 */
/** Корень монорепы: базовая конфигурация лежит именно в нём */
const repoRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Конфигурация Jest для пакета.
 *
 * @param fileUrl - `import.meta.url` конфига пакета
 * @param overrides - Поля, которыми пакет уточняет базу; так собран,
 * например, отдельный прогон e2e
 */
export function createJestConfig(fileUrl, overrides = {}) {
  const __filename = fileURLToPath(fileUrl);
  const rootDir = dirname(__filename);

  return {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    // Условие `"testing"` включено во всех тестах репозитория: тестовые
    // subpath'ы пакетов (`@nestling/app/testing` и его аналоги в
    // пользовательских модулях) резолвятся только здесь, а прод-импорт
    // падает на резолве
    testEnvironmentOptions: {
      customExportConditions: ['testing', 'node', 'node-addons'],
    },
    rootDir,
    // `Symbol.dispose`/`Symbol.asyncDispose` в vm-контексте теста — без них
    // `await using` падает в хелпере, который эмитит ts-jest
    setupFiles: [`${repoRoot}/.config/jest.setup.disposable.cjs`],
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
      '^.+\\.ts$': [
        'ts-jest',
        {
          useESM: true,
          // Диагностики — только по файлам пакета под тестом. Исходники
          // соседей приезжают сюда через `moduleNameMapper` и компилируются
          // **чужим** tsconfig'ом, у которого нет ни их `customConditions`,
          // ни их путей: тестовый subpath соседа из такого прогона не
          // резолвится, и падение зависит от состояния кэша. Проверять их
          // здесь и незачем — каждый пакет тайпчекается своим `tsc` на
          // таргете `build`, и `yarn verify` гоняет его для всех.
          diagnostics: { exclude: [`!${rootDir}/**`] },
          tsconfig: {
            target: 'es2022',
            // `await using` в тестах: `Symbol.asyncDispose` есть в рантайме
            // Node 20+, но типам нужна отдельная библиотека. `dom` —
            // то, что подтягивал бы умолчательный `es2022.full`
            lib: ['es2022', 'dom', 'dom.iterable', 'esnext.disposable'],
            useDefineForClassFields: true,
            experimentalDecorators: false,
            emitDecoratorMetadata: false,
            // Пакетные tsconfig ограничивают rootDir своим src, но moduleNameMapper
            // ниже мапит workspace-пакеты на исходники соседних пакетов.
            // Поднимаем rootDir до корня монорепы, чтобы ts-jest их принимал.
            rootDir: '../..',
          },
        },
      ],
    },
    moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
      '^lodash-es$': 'lodash',
      // Пути к исходникам пакетов отсчитываются от корня монорепы, а не от
      // каталога пакета под тестом: тесты примеров лежат в `examples/`, и
      // соседей у них там нет
      // Тестовый subpath — до общего правила ниже: иначе `@nestling/app/testing`
      // уехал бы в несуществующий `nestling.app/testing/src/index.ts`
      '^@nestling/([^/]*)/testing$': `${repoRoot}/packages/nestling.$1/src/testing/index.ts`,
      // Subpath токенов (`@nestling/container/tokens`) — тоже до общего
      // правила: его точка входа лежит файлом `src/tokens.ts`, а не каталогом
      '^@nestling/([^/]*)/tokens$': `${repoRoot}/packages/nestling.$1/src/tokens.ts`,
      // Маппинг всех workspace пакетов на исходники
      '^@nestling/(.*)$': `${repoRoot}/packages/nestling.$1/src/index.ts`,
      '^@common/(.*)$': `${repoRoot}/packages/common.$1/src/index.ts`,
    },
    ...overrides,
  };
}
