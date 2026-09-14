import { dirname } from 'path';
import { fileURLToPath } from 'url';

import swc from 'unplugin-swc';

/** Корень монорепы: базовая конфигурация лежит именно в нём */
const repoRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Конфигурация vitest для пакета.
 *
 * @param fileUrl - `import.meta.url` конфига пакета
 * @param overrides - Поля секции `test`, которыми пакет уточняет базу; так
 * собран, например, отдельный прогон e2e
 */
export function createVitestConfig(fileUrl, overrides = {}) {
  const rootDir = dirname(fileURLToPath(fileUrl));

  return {
    plugins: [
      // Умолчательный трансформ vitest — esbuild, и он знает только
      // legacy-декораторы: на первом `@Component` файл падает
      // `SyntaxError`. swc компилирует стандартные декораторы ECMAScript
      swc.vite({
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', decorators: true },
          transform: {
            decoratorVersion: '2022-03',
            // Та же семантика полей класса, что у сборки пакета: оба поля
            // стоят в `tsconfig.base.json`
            useDefineForClassFields: true,
          },
          // Имя класса читают сообщения контейнера и снапшоты графа
          keepClassNames: true,
        },
      }),
    ],
    resolve: {
      // Условие `"testing"` включено во всех тестах репозитория: тестовые
      // subpath'ы пакетов (`@nestlingjs/app/testing` и его аналоги в
      // пользовательских модулях) резолвятся только здесь, а прод-импорт
      // падает на резолве
      conditions: ['testing', 'node', 'node-addons', 'import', 'default'],
      // Пути к исходникам пакетов отсчитываются от корня монорепы, а не от
      // каталога пакета под тестом: тесты примеров лежат в `examples/`, и
      // соседей у них там нет
      alias: [
        // Тестовый subpath — до общего правила ниже: иначе
        // `@nestlingjs/app/testing` уехал бы в несуществующий
        // `nestling.app/testing/src/index.ts`
        {
          find: /^@nestlingjs\/([^/]*)\/testing$/,
          replacement: `${repoRoot}/packages/nestling.$1/src/testing/index.ts`,
        },
        // Subpath токенов (`@nestlingjs/container/tokens`) — тоже до общего
        // правила: его точка входа лежит файлом `src/tokens.ts`, а не каталогом
        {
          find: /^@nestlingjs\/([^/]*)\/tokens$/,
          replacement: `${repoRoot}/packages/nestling.$1/src/tokens.ts`,
        },
        // Subpath'ы адаптеров хранилищ (`@nestlingjs/drizzle.pg/outbox`,
        // `@nestlingjs/drizzle.pg/inbox`) и листовые subpath'ы их таблиц: их
        // точки входа лежат внутри `src`, и общее правило увело бы их в
        // несуществующий `nestling.drizzle.pg/outbox/src/index.ts`
        {
          find: /^@nestlingjs\/([^/]*)\/outbox\/table$/,
          replacement: `${repoRoot}/packages/nestling.$1/src/outbox/table.ts`,
        },
        {
          find: /^@nestlingjs\/([^/]*)\/outbox$/,
          replacement: `${repoRoot}/packages/nestling.$1/src/outbox/index.ts`,
        },
        {
          find: /^@nestlingjs\/([^/]*)\/inbox\/table$/,
          replacement: `${repoRoot}/packages/nestling.$1/src/inbox/table.ts`,
        },
        {
          find: /^@nestlingjs\/([^/]*)\/inbox$/,
          replacement: `${repoRoot}/packages/nestling.$1/src/inbox/index.ts`,
        },
        // Внутренние пакеты — до общего правила: их каталог называется
        // `common.<имя>`, а не `nestling.<имя>`, и общее правило увело бы
        // `@nestlingjs/common.misc` в несуществующий `nestling.common.misc`
        {
          find: /^@nestlingjs\/common\.(.*)$/,
          replacement: `${repoRoot}/packages/common.$1/src/index.ts`,
        },
        // Маппинг всех workspace пакетов на исходники
        {
          find: /^@nestlingjs\/(.*)$/,
          replacement: `${repoRoot}/packages/nestling.$1/src/index.ts`,
        },
      ],
    },
    test: {
      root: rootDir,
      environment: 'node',
      include: ['{src,type-tests,e2e}/**/*.{spec,test}.ts'],
      // Пакет без единой спеки — `common.graphs`, `common.static-server`,
      // `viz` — иначе выходит с кодом 1
      passWithNoTests: true,
      ...overrides,
    },
  };
}
