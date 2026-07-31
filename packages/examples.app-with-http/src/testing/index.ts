/**
 * Тестовая capability примера — subpath `./testing`.
 *
 * Экспорт conditional: условие `"testing"` включено только в тест-раннере,
 * поэтому прод-импорт `examples.app-with-http/testing` не резолвится **на
 * уровне Node**. Граница структурная, а не конвенция.
 *
 * Поверхность курируемая: наружу уезжают токены, разрешённые к подмене, и
 * готовые фейки, которые автор держит в контракте с реализацией. Всё
 * остальное — `UsersStore`, `StoredUsersRepository`, внутренние типы —
 * остаётся внутренностями пакета.
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
 * Фейк репозитория поверх массива: ни соединения, ни `@OnInit`.
 *
 * Живёт рядом с реализацией намеренно — так фейк не разъезжается с портом:
 * поменялся `IUsersRepository`, и фейк перестал компилироваться тем же
 * коммитом.
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
