/**
 * Список публикуемых пакетов репозитория — общая часть проверки упаковки и
 * публикации.
 *
 * Каталог пакета из его имени не выводится: скоуп у всех общий, а каталоги
 * называются по-разному (`@nestlingjs/app` лежит в `packages/nestling.app`,
 * `@nestlingjs/common.misc` — в `packages/common.misc`). Соответствие
 * читается из манифестов.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '..');

/**
 * Публикуемые пакеты: имя, каталог и манифест. Пакет с `private: true`
 * в список не входит — реестр его не примет и принимать не должен
 */
export function publishablePackages() {
  return readdirSync(join(repoRoot, 'packages'))
    .map((entry) => {
      const dir = join(repoRoot, 'packages', entry);
      const manifest = join(dir, 'package.json');

      if (!existsSync(manifest)) {
        return null;
      }

      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));

      return pkg.private ? null : { name: pkg.name, dir, pkg };
    })
    .filter(Boolean);
}

/** Имя файла тарбола: имя пакета без скоупа и слэшей */
export function slugOf(name) {
  return name.replace('@', '').replace('/', '-');
}
