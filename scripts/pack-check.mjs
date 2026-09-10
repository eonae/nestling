/**
 * Проверка упаковки: каждый публикуемый пакет ставится из тарбола в проект
 * вне репозитория и импортируется оттуда.
 *
 * Ловит класс «собралось и грузится здесь, но не работает у установившего».
 * Таких поломок три, и ни одну не видит `scripts/smoke.mjs`: он грузит
 * `dist/index.js` на месте, где рядом лежат и `src`, и соседние пакеты по
 * симлинкам workspace'а.
 *
 * 1. Пакет без `files` — тарбол уносит `src`, конфиги и спеки, а без
 *    `files` легко не заметить и обратное: сборку, которой в тарболе нет.
 * 2. Протокол `workspace:` в опубликованном манифесте — реестр его не
 *    понимает, установка падает на резолве.
 * 3. Зависимость, объявленная в `devDependencies`, но импортируемая из
 *    `src` — у установившего её нет.
 *
 * Прогон: `yarn pack:check`. В `yarn verify` не входит: ставит пакеты из
 * сети и занимает минуты. Требует собранных `dist` — запускать после
 * `yarn build`.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { publishablePackages, repoRoot as root, slugOf } from './packages.mjs';

const run = promisify(execFile);

/**
 * Условие `testing` включено для всех: тестовые subpath'ы пакетов
 * (`@nestlingjs/app/testing`) резолвятся только под ним, и без него
 * `@nestlingjs/testing` не грузится by design.
 */
const NODE_ARGS = ['--conditions=testing'];

const failures = [];
const fail = (name, message) => failures.push({ name, message });

const packages = publishablePackages();

for (const { name, dir } of packages) {
  if (!existsSync(join(dir, 'dist'))) {
    fail(name, 'нет каталога dist — прогоните `yarn build` перед проверкой');
  }
}

if (failures.length > 0) {
  report();
}

const work = mkdtempSync(join(tmpdir(), 'nestling-pack-'));
const tarballs = join(work, 'tarballs');
const consumer = join(work, 'consumer');
mkdirSync(tarballs);
mkdirSync(consumer);

console.log(`[pack-check] ${packages.length} пакетов, рабочий каталог ${work}`);

// 1. Упаковка. `yarn pack` подставляет версии вместо протокола `workspace:`
//    и отбирает файлы по `files` — тем же путём, которым идёт публикация
for (const { name } of packages) {
  const out = join(tarballs, `${slugOf(name)}.tgz`);
  await run('yarn', ['workspace', name, 'pack', '--out', out], { cwd: root });

  const manifest = await run('tar', ['-xzOf', out, 'package/package.json'], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const packed = JSON.parse(manifest.stdout);
  const specifiers = Object.values({
    ...packed.dependencies,
    ...packed.peerDependencies,
  });

  if (specifiers.some((spec) => String(spec).startsWith('workspace:'))) {
    fail(name, 'в манифесте тарбола остался протокол workspace:');
  }

  const listing = await run('tar', ['-tzf', out], { maxBuffer: 8 * 1024 * 1024 });
  const entries = listing.stdout.split('\n').filter(Boolean);
  const testCode = entries.filter(
    (entry) =>
      entry.startsWith('package/src/') ||
      entry.startsWith('package/type-tests/') ||
      /^package\/(tsconfig.*\.json|eslint\.config\.js|jest\.config\.js)$/.test(entry),
  );

  if (testCode.length > 0) {
    fail(name, `в тарболе ${testCode.length} файл(ов) не из сборки, первый — ${testCode[0]}`);
  }
}

// 2. Проект-потребитель. `overrides` уводит и транзитивные зависимости на
//    тарболы: в реестре этих версий ещё нет, и без них установка падает
const dependencies = Object.fromEntries(
  packages.map(({ name }) => [name, `file:${join(tarballs, `${slugOf(name)}.tgz`)}`]),
);

writeFileSync(
  join(consumer, 'package.json'),
  `${JSON.stringify(
    { name: 'pack-check-consumer', private: true, type: 'module', dependencies, overrides: dependencies },
    null,
    2,
  )}\n`,
);

console.log('[pack-check] установка тарболов');

try {
  await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: consumer,
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (error) {
  fail('npm install', String(error.stderr || error.message).trim());
  report();
}

// 3. Импорт установленного пакета настоящим Node'ом
console.log('[pack-check] импорт установленных пакетов');

await Promise.all(
  packages.map(async ({ name }) => {
    try {
      await run(
        process.execPath,
        [...NODE_ARGS, '--input-type=module', '-e', `await import(${JSON.stringify(name)})`],
        { cwd: consumer },
      );
    } catch (error) {
      fail(name, String(error.stderr || error.message).trim());
    }
  }),
);

report();

function report() {
  if (failures.length > 0) {
    console.error(`\n[pack-check] ${failures.length} пакет(ов) не проходят проверку упаковки:\n`);
    for (const { name, message } of failures) {
      console.error(`  ${name}\n    ${message.split('\n').join('\n    ')}\n`);
    }
    process.exit(1);
  }

  console.log(`[pack-check] ${packages.length} package(s) install and load: ok`);
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}
