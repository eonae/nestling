/**
 * `@nestling/eslint-plugin` — editor-фидбек по декларациям ручек.
 *
 * Пакет отдельный намеренно: плагин ESLint обязан быть отдельной точкой
 * установки, и у него другой цикл релиза, чем у рантайма. Рантайм
 * `@nestling/*` в зависимостях не появляется — правила синтаксические.
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

export { endpointHasLayer } from './endpoint-has-layer.js';

const plugin = {
  meta: {
    name: '@nestling/eslint-plugin',
    version: '0.1.0',
  },
  rules: {
    'endpoint-has-layer': endpointHasLayer,
  },
};

export default plugin;
