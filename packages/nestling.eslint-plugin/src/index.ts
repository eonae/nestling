/**
 * `@nestling/eslint-plugin` — фидбек в редакторе по коду на Nestling.
 *
 * Пакет отдельный намеренно: плагин ESLint обязан быть отдельной точкой
 * установки, и у него другой цикл релиза, чем у рантайма. Рантайм
 * `@nestling/*` в зависимостях не появляется — правила разбирают синтаксис
 * и файловую структуру.
 *
 * Правила отличаются полнотой, и от неё зависит рекомендуемый уровень.
 * `endpoint-has-layer` неполно by design (пайплайн — значение, текущее через
 * фабрики) и потому рекомендуется как `warn`. `import-through-barrel`
 * полно: спецификаторы импорта — литералы.
 *
 * @example flat config
 * ```javascript
 * import nestling from '@nestling/eslint-plugin';
 *
 * export default [
 *   {
 *     files: ['src/**\/*.ts'],
 *     plugins: { '@nestling': nestling },
 *     rules: {
 *       '@nestling/import-through-barrel': 'error',
 *       '@nestling/endpoint-has-layer': [
 *         'warn',
 *         { layer: 'authedBase', constructorName: 'httpEndpoint' },
 *       ],
 *     },
 *   },
 * ];
 * ```
 */

import { endpointHasLayer } from './endpoint-has-layer.js';
import { importThroughBarrel } from './import-through-barrel.js';

export { endpointHasLayer } from './endpoint-has-layer.js';
export { importThroughBarrel } from './import-through-barrel.js';

const plugin = {
  meta: {
    name: '@nestling/eslint-plugin',
    version: '0.1.0',
  },
  rules: {
    'endpoint-has-layer': endpointHasLayer,
    'import-through-barrel': importThroughBarrel,
  },
};

export default plugin;
