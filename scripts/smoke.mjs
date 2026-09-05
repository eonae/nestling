/**
 * Smoke-проверка упаковки: каждый собранный пакет грузится настоящим Node'ом.
 *
 * Ловит класс «собралось, но не устанавливается»: `tsc` переносит
 * относительные специфаеры в `dist` дословно, а Node ESM не понимает ни
 * импорт каталога (`./core`), ни специфаер без расширения. Тайпчек этого
 * не видит — `moduleResolution: bundler` такие импорты разрешает, — и не
 * видит jest: он гоняет исходники.
 *
 * Проверяется каждый пакет `packages/*` с собранным `dist/index.js`.
 * Примеры лежат в `examples/` и сюда не попадают: их собирает esbuild в
 * бандл, где специфаеры уже разрешены.
 *
 * Прогон: `node scripts/smoke.mjs` (входит в `yarn verify`).
 */
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

/**
 * Условие `testing` включено для всех: тестовые subpath'ы пакетов
 * (`@nestling/app/testing`) резолвятся только под ним, и без него
 * `@nestling/testing` не грузится by design.
 */
const NODE_ARGS = ['--conditions=testing'];

const targets = readdirSync(join(root, 'packages'))
  .map((name) => {
    const dir = join(root, 'packages', name);
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) return null;

    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    const entry = join(dir, 'dist', 'index.js');

    // Пакет без tsc-сборки (или без точки входа) проверять нечем
    return existsSync(entry) ? { name: pkg.name, entry } : null;
  })
  .filter(Boolean);

const failures = [];

await Promise.all(
  targets.map(async ({ name, entry }) => {
    try {
      await run(process.execPath, [...NODE_ARGS, '--input-type=module', '-e',
        `await import(${JSON.stringify(entry)})`]);
    } catch (error) {
      failures.push({ name, message: String(error.stderr || error.message).trim() });
    }
  }),
);

if (failures.length > 0) {
  console.error(`[smoke] ${failures.length} package(s) cannot be loaded by Node:\n`);
  for (const { name, message } of failures) {
    console.error(`  ${name}\n${message.split('\n').slice(0, 4).map((l) => `    ${l}`).join('\n')}\n`);
  }
  console.error(
    `Relative specifiers must be complete: './core' → './core/index.js', ` +
      `'./common' → './common.js'.`,
  );
  process.exit(1);
}

console.log(`[smoke] ${targets.length} package(s) load in Node: ok`);
