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
 * `error`. `conditional-spread` полно по форме, которую разбирает: пустой
 * объектный литерал виден в тексте файла целиком, уровень `error`.
 * `no-process-globals` полно по прямой записи глобали, уровень `error`.
 * `endpoint-has-layer` неполно by design (пайплайн — значение, текущее
 * через фабрики), уровень `warn`. `dependency-list` выводит список
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
 *       '@nestlingjs/conditional-spread': 'error',
 *       '@nestlingjs/no-process-globals': 'error',
 *       '@nestlingjs/endpoint-has-layer': [
 *         'warn',
 *         { layer: 'authed', constructorName: 'httpEndpoint' },
 *       ],
 *       '@nestlingjs/dependency-list': 'warn',
 *     },
 *   },
 * ];
 * ```
 */

import { conditionalSpread } from './conditional-spread.js';
import { dependencyList } from './dependency-list.js';
import { endpointHasLayer } from './endpoint-has-layer.js';
import { importThroughBarrel } from './import-through-barrel.js';
import { noProcessGlobals } from './no-process-globals.js';

import type { Rule } from 'eslint';

export { conditionalSpread } from './conditional-spread.js';
export { dependencyList } from './dependency-list.js';
export { endpointHasLayer } from './endpoint-has-layer.js';
export { importThroughBarrel } from './import-through-barrel.js';
export { noProcessGlobals } from './no-process-globals.js';

const plugin: {
  meta: { name: string; version: string };
  rules: {
    'conditional-spread': Rule.RuleModule;
    'dependency-list': Rule.RuleModule;
    'endpoint-has-layer': Rule.RuleModule;
    'import-through-barrel': Rule.RuleModule;
    'no-process-globals': Rule.RuleModule;
  };
} = {
  meta: {
    name: '@nestlingjs/eslint-plugin',
    version: '0.1.0',
  },
  rules: {
    'conditional-spread': conditionalSpread,
    'dependency-list': dependencyList,
    'endpoint-has-layer': endpointHasLayer,
    'import-through-barrel': importThroughBarrel,
    'no-process-globals': noProcessGlobals,
  },
};

export default plugin;
