/* eslint-disable no-undef */
/* eslint-disable unicorn/no-process-exit */

import { build } from 'esbuild';

/**
 * Шим `require` для ESM-бандла.
 *
 * `bundle: true` затаскивает внутрь CommonJS-зависимости (`busboy` в парсере
 * multipart, `find-my-way` в роутере), внутри которых остаются вызовы
 * `require(...)`. В ESM-выводе esbuild подменяет их заглушкой, бросающей
 * `Dynamic require of "..." is not supported`, потому что глобального
 * `require` в модуле нет — и бандл падает на старте, хотя сборка успешна.
 * Баннер объявляет настоящий `require` до кода бандла, и заглушка esbuild
 * уходит в рабочую ветку.
 *
 * `__filename`/`__dirname` намеренно не шимим: обращений к ним в бандле нет,
 * а их наличие может увести чужой CJS-код в ветку «мы в CommonJS».
 *
 * https://github.com/evanw/esbuild/issues/1921
 */
const CJS_REQUIRE_SHIM = `
import { createRequire as __nestlingCreateRequire } from 'node:module';
if (typeof globalThis.require === 'undefined') {
  globalThis.require = __nestlingCreateRequire(import.meta.url);
}
`;

const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outfile: 'dist/bundle.js',
  sourcemap: true,
  banner: { js: CJS_REQUIRE_SHIM },
};

build(config).catch(() => process.exit(1));
