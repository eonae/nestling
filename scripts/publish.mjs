/**
 * Публикация пакетов в реестр. Запускается workflow'ом релиза по тегу `v*`;
 * с рабочей машины не работает — ключ доступа живёт секретом репозитория.
 *
 * Тарбол делает `yarn pack`: он подставляет версии вместо протокола
 * `workspace:` и отбирает файлы по `files`. Отправляет тарбол `npm publish`
 * — ради provenance, которого yarn не умеет: подпись выдаёт OIDC-обмен,
 * доступный только npm CLI внутри GitHub Actions.
 *
 * Версии скрипт не поднимает и ничего не коммитит: версию поднимает
 * человек (`yarn lerna version`), тег ставит человек. Скрипт лишь сверяет,
 * что тег и манифесты говорят одно и то же.
 *
 * Прогон: `node scripts/publish.mjs`. Переменные окружения — `GITHUB_REF_NAME`
 * (тег), `NODE_AUTH_TOKEN` (ключ доступа), `NPM_CONFIG_PROVENANCE`.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { publishablePackages, repoRoot, slugOf } from './packages.mjs';

const run = promisify(execFile);

const packages = publishablePackages();
const tag = process.env.GITHUB_REF_NAME;

// Тег `v0.1.0` и версия `0.1.0` в манифестах — одно и то же число.
// Расхождение означает, что тег поставлен не на том коммите
if (tag) {
  const expected = tag.replace(/^v/, '');
  const mismatched = packages.filter(({ pkg }) => pkg.version !== expected);

  if (mismatched.length > 0) {
    console.error(
      `[publish] тег ${tag} обещает версию ${expected}, но манифесты говорят другое:\n` +
        mismatched.map(({ name, pkg }) => `  ${name}: ${pkg.version}`).join('\n'),
    );
    process.exit(1);
  }
}

const tarballs = join(mkdtempSync(join(tmpdir(), 'nestling-publish-')), 'tarballs');
mkdirSync(tarballs);

console.log(`[publish] ${packages.length} пакетов, версия ${packages[0]?.pkg.version}`);

for (const { name } of packages) {
  const out = join(tarballs, `${slugOf(name)}.tgz`);

  await run('yarn', ['workspace', name, 'pack', '--out', out], { cwd: repoRoot });
  await run('npm', ['publish', out, '--access', 'public'], {
    cwd: repoRoot,
    maxBuffer: 32 * 1024 * 1024,
  });

  console.log(`[publish] ${name} опубликован`);
}

console.log(`[publish] ${packages.length} package(s) published: ok`);
