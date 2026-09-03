import type { User } from './users/user';
import type { UsersRepository } from './users/users.repository';

/**
 * Фейк хранилища поверх массива: без соединения и без `@OnInit`.
 *
 * Лежит рядом с интерфейсом: изменился `UsersRepository`, и фейк перестал
 * компилироваться в том же коммите.
 */
export function inMemoryUsersRepo(seed: readonly User[] = []): UsersRepository {
  const rows: User[] = seed.map((user) => ({ ...user }));

  return {
    all: async () => rows,
    byId: async (id) => rows.find((user) => user.id === id) ?? null,
    byEmail: async (email) => rows.find((user) => user.email === email) ?? null,
    insert: async (data) => {
      const user: User = { id: String(rows.length + 1), ...data };
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
