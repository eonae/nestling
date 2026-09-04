# 7. Убедиться, что работает, без запуска сервера

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-04).
> Целевое описание: [design/testing.md](../design/testing.md). Почему так:
> запись [ideas.md](../decisions/ideas.md) «[2026-07-10] Пакет
> тестирования (`@nestling/testing`)».

Тесты должны вызывать endpoint'ы через тот же пайплайн, что и запросы по
сети, но без сокета, без базы и без переменных окружения. Отдельно нужен
быстрый юнит-тест хендлера, в котором нет ни контейнера, ни приложения.

```typescript
// packages/examples.users-service/src/app.ts (фрагмент)
export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  // …
});
```

Тест должен собирать то же приложение, что и `main.ts`, — весь его
состав целиком. Поэтому декларация лежит в отдельном файле, а
`main.ts` и тесты импортируют одно и то же значение `app`. Словарь
состава в тест не копируется: `assembleTest` принимает саму декларацию.

```typescript
// packages/examples.users-service/src/app.spec.ts
import { app } from './app.js';

/** Конфиг теста: объект вместо `process.env` */
const testConfig = vars({ API_TOKEN: 'test-token' });
```

Тест задаёт только то, что относится к прогону: подмены, выбор фич и
конфиг. Транспорты подменять не нужно: тестовая сборка не выполняет
START, поэтому сокет не открывается и порт не занимается.

## Вызов через полный пайплайн

```typescript
// packages/examples.users-service/src/app.spec.ts
it('отдаёт пользователя через полный пайплайн', async () => {
  await using testApp = await assembleTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
  });

  expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
  expect(unwrap(await testApp.call(ListUsers, {}))).toHaveLength(2);
});
```

`assembleTest(app, options)` собирает ту же декларацию и проводит
приложение по фазам до `WIRE`: граф построен, политики проверены так же,
как при старте, `@OnInit` выполнен, таблица маршрутов создана. Тестовая
сборка их не ослабляет: приложение, которое не собирается в бою, не
собирается и в тесте. Сокет не открывается, обработчики сигналов не
ставятся. `await using` закрывает приложение в конце теста. Переменная
названа `testApp`, чтобы не затенять `app` из `app.ts`.

`testApp.call(Endpoint, payload)` вызывает endpoint по значению
декларации и проверяет тот же вход, что и запрос по сети, — поэтому
`testApp.call` и HTTP дают один результат. Запрос проходит все слои
пайплайна, проверку входа по схеме и проверку отказов по `errors`.
Разбор пути, query и тела не выполняется: `call` принимает готовый
payload. `unwrap` возвращает значение успешного ответа или бросает ошибку
с категорией и кодом отказа.

Ответ несёт `isSuccess`, `status` и `value`. Для отказа в `value` лежат
код и детали, а `status` равен категории кода:

```typescript
// packages/examples.users-service/src/app.spec.ts
expect(await testApp.call(GetUser, { id: '404' })).toMatchObject({
  isSuccess: false,
  status: 'not_found',
  value: { code: 'not_found:user', details: { id: '404' } },
});
```

## Подмена узлов графа

```typescript
// packages/examples.users-service/src/testing.ts
export function inMemoryUsersRepo(seed: readonly User[] = []): UsersRepository {
  const rows: User[] = seed.map((user) => ({ ...user }));

  return {
    all: async () => rows,
    byId: async (id) => rows.find((user) => user.id === id) ?? null,
    // …
  };
}
```

Фейк реализует интерфейс `UsersRepository` поверх массива. Он лежит рядом
с интерфейсом: изменился интерфейс, и фейк перестал компилироваться в том
же коммите.

```typescript
// packages/examples.users-service/src/app.spec.ts
it('не создаёт узлы, которые нужны только подменённому хранилищу', async () => {
  await using testApp = await assembleTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  // Соединение с базой нужно только боевому хранилищу: после подмены
  // контейнер его не создаёт, и `@OnInit` не вызывается
  expect(testApp.pruned).toContain('Database');
});
```

`overrides` заменяет узел графа по токену; пара в нём типизирована,
поэтому фейк, не совпадающий с типом токена, не компилируется, а подмена
токена, которого нет в графе, останавливает сборку. Подмена происходит до
создания инстансов, поэтому поддерево, которое больше никому не нужно, из
графа выпадает. От `Database` зависит только боевой репозиторий: после
подмены контейнер её не создаёт, и соединение не открывается.
`testApp.pruned` перечисляет выпавшие узлы.

```typescript
// packages/examples.users-service/src/app.spec.ts
it('читает размер страницы из конфига', async () => {
  await using testApp = await assembleTest(app, {
    config: vars({ API_TOKEN: 'test-token', APP_PAGE_SIZE: '1' }),
    overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
  });

  expect(unwrap(await testApp.call(ListUsers, {}))).toEqual([alice]);
});
```

`vars(record)` даёт источник конфига из объекта и заменяет привязку
источников декларации целиком: `process.env` не читается и не меняется,
поэтому тесты изолированы и могут идти параллельно, а боевой источник в
тесте не инициализируется.

## Юнит-тест хендлера

```typescript
// packages/examples.users-service/src/users/endpoints/create-user.endpoint.spec.ts
describe('CreateUserHandler', () => {
  it('создаёт пользователя и отвечает created с заголовком Location', async () => {
    const handler = new CreateUserHandler(inMemoryUsersRepo([alice]));

    const result = await handler.handle({
      name: 'Carol',
      email: 'carol@example.com',
    });

    expect(result).toMatchObject({
      status: 'created',
      value: { id: '2', name: 'Carol' },
      headers: { Location: '/users/2' },
    });
  });
});
```

Класс-хендлер, как в главе 4, создаётся через `new` с фейком. Такой тест
проверяет логику хендлера и не проверяет пайплайн, схемы и список
`errors`: это работа теста, который вызывает endpoint через полный
пайплайн.

```bash
yarn workspace examples.users-service test
```

Сервис собран и покрыт тестами. Следующая часть готовит его к
продакшену, начиная с журнала запросов: [8. Видеть каждый запрос в
логе](./08-logging.md).
