/**
 * `@nestlingjs/eslint-plugin` — фидбек в редакторе по коду на Nestling.
 *
 * Пакет отдельный намеренно: плагин ESLint обязан быть отдельной точкой
 * установки, и у него другой цикл релиза, чем у рантайма. Рантайм
 * `@nestlingjs/*` в зависимостях не появляется — правила разбирают синтаксис
 * и файловую структуру.
 *
 * Правила отличаются полнотой, и от неё зависит рекомендуемый уровень.
 * `import-through-barrel` полно: спецификаторы импорта — литералы, уровень
 * `error`. `endpoint-has-layer` неполно by design (пайплайн — значение,
 * текущее через фабрики), уровень `warn`. `dependency-list` выводит список
 * зависимостей из типов параметров синтаксической таблицей и на типе вне
 * неё молчит; гарантией остаётся компилятор, уровень `warn`.
 *
 * @example flat config
 * ```javascript
 * import nestling from '@nestlingjs/eslint-plugin';
 *
 * export default [
 *   {
 *     files: ['src/**\/*.ts'],
 *     plugins: { '@nestlingjs': nestling },
 *     rules: {
 *       '@nestlingjs/import-through-barrel': 'error',
 *       '@nestlingjs/endpoint-has-layer': [
 *         'warn',
 *         { layer: 'authedBase', constructorName: 'httpEndpoint' },
 *       ],
 *       '@nestlingjs/dependency-list': 'warn',
 *     },
 *   },
 * ];
 * ```
 */

import { dependencyList } from './dependency-list.js';
import { endpointHasLayer } from './endpoint-has-layer.js';
import { importThroughBarrel } from './import-through-barrel.js';

export { dependencyList } from './dependency-list.js';
export { endpointHasLayer } from './endpoint-has-layer.js';
export { importThroughBarrel } from './import-through-barrel.js';

const plugin = {
  meta: {
    name: '@nestlingjs/eslint-plugin',
    version: '0.1.0',
  },
  rules: {
    'dependency-list': dependencyList,
    'endpoint-has-layer': endpointHasLayer,
    'import-through-barrel': importThroughBarrel,
  },
};

export default plugin;
