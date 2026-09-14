/**
 * Раскладка зависимостей манифеста — проверка механическая.
 *
 * Вид объявления задаёт тот, кто выбирает версию. Версию пакета
 * `@nestlingjs/*` выбирает репозиторий: пакеты выходят одним тегом и
 * совместимы только одной версией между собой, поэтому они стоят в
 * `dependencies`. Версию библиотеки выбирает приложение, и второй копии у
 * неё быть не должно: копии расходятся типами и внутренним устройством
 * значений, которые пересекают границу пакета. Такая библиотека стоит в
 * `peerDependencies` и одновременно в `devDependencies` того же манифеста —
 * peer объявляет требование к приложению, dev даёт сборке и спекам что
 * импортировать.
 *
 * Отказ печатается на каждое внешнее имя в `dependencies`, которого нет в
 * списке исключений. Исключение даётся библиотеке, чьи значения и типы
 * границу пакета не пересекают: приложение её не видит, и копий у неё
 * может быть сколько угодно.
 *
 * Читаются манифесты, а не сборка: `dist` проверке не нужен, и на чистом
 * клоне она работает. Приватный пакет в список не входит — его отдаёт
 * `publishablePackages()`, а в реестр он не попадает.
 *
 * Прогон: `node scripts/boundary/manifest-deps.mjs` (входит в
 * `yarn verify`). Спека — `manifest-deps.spec.mjs` рядом.
 */
import { fileURLToPath } from 'node:url';

import { publishablePackages } from '../packages.mjs';

/** Скоуп репозитория: его пакеты объявляются зависимостями */
const SCOPE = '@nestlingjs/';

/**
 * Библиотеки, которым `dependencies` разрешены, и причина у каждой.
 *
 * Добавить имя — правка этой константы, и она видна в диффе. Причина
 * пишется рядом: имя без причины через полгода от недосмотра не отличить.
 */
export const EXEMPT = new Map([
  ['busboy', 'разбор multipart внутри транспорта: значение наружу не выходит'],
  [
    'find-my-way',
    'маршрутизатор внутри транспорта: значение наружу не выходит',
  ],
  ['@opentelemetry/resources', '`Resource` собирается внутри слоя'],
  ['@opentelemetry/semantic-conventions', 'строковые константы имён'],
  ['@standard-schema/spec', 'только типы, рантайма нет'],
]);

/**
 * Внешние имена `dependencies` манифеста, которых нет в списке исключений.
 *
 * @param manifest - Разобранный `package.json` пакета
 * @returns Имена-расхождения; пустой список — раскладка держится
 */
export function strayDependencies(manifest) {
  return Object.keys(manifest.dependencies ?? {})
    .filter((name) => !name.startsWith(SCOPE))
    .filter((name) => !EXEMPT.has(name));
}

/**
 * Расхождения по всем публикуемым пакетам репозитория.
 *
 * @param packages - Пакеты в форме `publishablePackages()`
 * @returns Пары «пакет — зависимость», по одной на расхождение
 */
export function strayDeclarations(packages) {
  return packages.flatMap(({ name, pkg }) =>
    strayDependencies(pkg).map((dependency) => ({ package: name, dependency })),
  );
}

/** Куда переносится имя — текст подсказки под списком расхождений */
export const HINT =
  `The application picks the version of a library, so the library goes to ` +
  `peerDependencies and to devDependencies of the same manifest: the peer ` +
  `states the requirement, the dev entry gives the build and the specs ` +
  `something to import. A library whose values and types never cross the ` +
  `package boundary belongs in the exemption list of ` +
  `scripts/boundary/manifest-deps.mjs, with the reason written next to the ` +
  `name.`;

/** Прогон проверки: импортом файл ничего не печатает и не завершает процесс */
function main() {
  const packages = publishablePackages();
  const violations = strayDeclarations(packages);

  if (violations.length > 0) {
    console.error(
      `[manifest-deps] ${violations.length} dependency declaration(s) name a ` +
        `library the application also sees:\n`,
    );
    for (const one of violations) {
      console.error(`  ${one.package}: '${one.dependency}' is in dependencies`);
    }
    console.error(`\n${HINT}`);
    process.exit(1);
  }

  console.log(
    `[manifest-deps] ${packages.length} package(s) declare no library of ` +
      `their own: ok`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
