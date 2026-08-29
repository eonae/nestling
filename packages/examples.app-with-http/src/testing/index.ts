/**
 * Тестовая поверхность примера: subpath `./testing`.
 *
 * Экспорт условный: условие `"testing"` в `package.json` включено только
 * в тест-раннере, поэтому в production импорт
 * `examples.app-with-http/testing` не разрешается на уровне Node.
 *
 * Наружу выходят только токены, которые разрешено подменять, и готовые
 * фейки. `UsersStore`, `StoredUsersRepository` и внутренние типы остаются
 * внутри пакета.
 */

import type { User } from '../common/types';
import type { IUsersRepository } from '../modules/users/users.repository';

export { UsersRepository } from '../modules/users/users.repository';
export type { IUsersRepository } from '../modules/users/users.repository';

/** Пользователи, с которыми стартует фейк, если не задано иное */
const SEED: readonly User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: 'bob@example.com' },
];

/**
 * Создаёт фейк репозитория поверх массива: без соединения и без `@OnInit`.
 *
 * Фейк лежит рядом с реализацией, чтобы не отставать от неё: изменился
 * `IUsersRepository` — фейк перестал компилироваться в том же коммите.
 *
 * @param seed - Начальные пользователи; по умолчанию те же двое, что и в
 * боевом хранилище
 *
 * @example
 * ```typescript
 * await using app = await assembleTest({
 *   features: [UsersFeature],
 *   transports: [http()],
 *   overrides: [[UsersRepository, inMemoryUsersRepo()]],
 * });
 * ```
 */
export function inMemoryUsersRepo(
  seed: readonly User[] = SEED,
): IUsersRepository {
  const rows: User[] = seed.map((user) => ({ ...user }));
  let nextId = rows.length + 1;

  return {
    all: async () => rows,
    byId: async (id) => rows.find((user) => user.id === id) ?? null,
    byEmail: async (email) => rows.find((user) => user.email === email) ?? null,
    insert: async (data) => {
      const user: User = { id: String(nextId++), ...data };
      rows.push(user);

      return user;
    },
    patch: async (id, data) => {
      const index = rows.findIndex((user) => user.id === id);
      if (index === -1) {
        return null;
      }

      rows[index] = { ...rows[index], ...data };

      return rows[index];
    },
    remove: async (id) => {
      const index = rows.findIndex((user) => user.id === id);
      if (index === -1) {
        return false;
      }

      rows.splice(index, 1);

      return true;
    },
  };
}
