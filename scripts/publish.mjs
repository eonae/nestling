/**
 * Публикация пакетов в реестр.
 *
 * Режима два. Workflow релиза запускает скрипт по тегу `v*` без аргументов:
 * право публиковать даёт OIDC-обмен с доверенным издателем, ключа доступа
 * в репозитории нет. Человек запускает скрипт с `--interactive`, когда имя
 * публикуется впервые: доверенного издателя нельзя привязать к пакету,
 * которого ещё нет в реестре, поэтому первую версию имени отправляет
 * человек, отвечая на запрос кода 2FA.
 *
 * Тарбол делает `yarn pack`: он подставляет версии вместо протокола
 * `workspace:` и отбирает файлы по `files`. Отправляет тарбол `npm publish`
 * ради provenance, которого yarn не умеет. Подпись выдаёт тот же
 * OIDC-обмен, поэтому у версии, опубликованной с рабочей машины,
 * provenance нет.
 *
 * Версии скрипт не поднимает и ничего не коммитит: версию поднимает
 * человек (`yarn lerna version`), тег ставит человек. Скрипт лишь сверяет,
 * что тег и манифесты говорят одно и то же.
 *
 * Прогон: `node scripts/publish.mjs [--interactive]`. Переменные окружения —
 * `GITHUB_REF_NAME` (тег) и `NPM_CONFIG_PROVENANCE`.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

import { publishablePackages, repoRoot, slugOf } from './packages.mjs';

const run = promisify(execFile);

const interactive = process.argv.includes('--interactive');
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

const prompt = interactive
  ? createInterface({ input: process.stdin, output: process.stdout })
  : null;

// Код 2FA живёт между пакетами: см. комментарий у publish()
let otp = null;

if (interactive) {
  console.log(`[publish] аккаунт ${await whoami()}`);
  console.log('[publish] publish идёт не из CI, поэтому provenance у этих версий не будет');
}

const tarballs = join(mkdtempSync(join(tmpdir(), 'nestling-publish-')), 'tarballs');
mkdirSync(tarballs);

console.log(`[publish] ${packages.length} пакетов, версия ${packages[0]?.pkg.version}`);

for (const { name, pkg } of packages) {
  if (await isPublished(name, pkg.version)) {
    console.log(`[publish] ${name}@${pkg.version} уже в реестре — пропуск`);
    continue;
  }

  const out = join(tarballs, `${slugOf(name)}.tgz`);

  await run('yarn', ['workspace', name, 'pack', '--out', out], { cwd: repoRoot });
  await publish(name, out);

  console.log(`[publish] ${name} опубликован`);
}

prompt?.close();

console.log(`[publish] ${packages.length} package(s) published: ok`);

/**
 * Отправляет тарбол в реестр.
 *
 * Введённый код 2FA переиспользуется, пока реестр его принимает. Код живёт
 * полминуты, а публикация всех пакетов занимает дольше, поэтому одного
 * ввода на весь прогон не хватит. Отказ по коду означает, что он истёк:
 * скрипт спрашивает следующий и повторяет отправку того же тарбола.
 */
async function publish(name, tarball) {
  for (;;) {
    if (interactive && otp === null) otp = await askOtp(name);

    const args = ['publish', tarball, '--access', 'public'];

    if (otp !== null) args.push('--otp', otp);

    try {
      await run('npm', args, { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });

      return;
    } catch (error) {
      if (!interactive || !rejectedOtp(error)) throw error;

      console.log('[publish] реестр не принял код');
      otp = null;
    }
  }
}

/** Спрашивает код 2FA. Пустой ответ останавливает публикацию. */
async function askOtp(name) {
  const answer = (await prompt.question(`[publish] код 2FA (${name}): `)).trim();

  if (answer === '') {
    console.error('[publish] код не введён, публикация остановлена');
    prompt.close();
    process.exit(1);
  }

  return answer;
}

/** Отличает отказ по коду 2FA от прочих ошибок реестра. */
function rejectedOtp(error) {
  const output = `${error.stderr ?? ''}${error.stdout ?? ''}`;

  return output.includes('EOTP') || output.includes('one-time pass');
}

/** Имя аккаунта, под которым выполнен вход в реестр. */
async function whoami() {
  try {
    const { stdout } = await run('npm', ['whoami'], { cwd: repoRoot });

    return stdout.trim();
  } catch {
    console.error('[publish] входа в реестр нет: выполните `npm login`');
    process.exit(1);
  }
}

/**
 * Есть ли эта версия в реестре.
 *
 * Публикация идёт пакет за пакетом и не атомарна: упавшая на середине
 * оставляет часть версий опубликованной, а повторный запуск без этой
 * проверки падал бы на первой из них с `EPUBLISHCONFLICT`. Пропуск делает
 * прогон повторяемым — тот же тег доводит релиз до конца.
 */
async function isPublished(name, version) {
  try {
    await run('npm', ['view', `${name}@${version}`, 'version'], { cwd: repoRoot });

    return true;
  } catch {
    // Реестр отвечает 404 и на неизвестный пакет, и на неизвестную версию
    return false;
  }
}
