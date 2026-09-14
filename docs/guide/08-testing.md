# 8. Убедиться, что работает, без запуска сервера

> Гайд по текущему API; сверено с кодом `86c47c0a`.
> Целевое описание: [design/testing.md](../design/testing.md). Почему так:
> запись [ideas.md](../decisions/ideas.md) «[2026-07-10] Пакет
> тестирования (`@nestlingjs/testing`)».

Тесты должны вызывать endpoint'ы через тот же пайплайн, что и запросы по
сети, но без сокета и без переменных окружения. Отдельно нужен быстрый
юнит-тест хендлера, в котором нет ни контейнера, ни приложения, ни базы.

```typescript
// src/app.ts (фрагмент)
export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  // …
});
```

Тест должен собирать то же приложение, что и `main.ts`, — весь его
состав целиком. Поэтому декларация лежит в отдельном файле, а
`main.ts` и тесты импортируют одно и то же значение `app`. Словарь
состава в тест не копируется: `buildTest` принимает саму декларацию.

```typescript
// src/app.spec.ts
import { app } from './app.js';

/** Конфиг теста: объект вместо `process.env` */
const testConfig = [
  bind(
    vars({ API_TOKEN: 'test-token', DATABASE_URL: TEST_DATABASE_URL ?? '' }),
  ),
];
```

Тест задаёт только то, что относится к прогону: подмены, выбор фич и
конфиг. Транспорты подменять не нужно: тестовая сборка не выполняет
START, поэтому сокет не открывается и порт не занимается.

База в этом наборе настоящая. Пул открывается на фазе INIT, а слой
транзакции и хранилище outbox'а пишут SQL, поэтому подменить их фейком
значило бы проверять не тот код, который работает в проде. Спеки
приложения пропускаются без `TEST_DATABASE_URL`: локально базу поднимает
`yarn db:up`, в CI — сервис workflow'а ([глава
11](./11-database.md)). Юнит-тест хендлера базы не
требует и не пропускается никогда.

## Условие резолва в тест-раннере

Тест-раннер обязан включать условие `testing`. Тестовые поверхности
пакетов — `@nestlingjs/testing` целиком и подпути `./testing` у `app` и
транспортов — объявлены conditional export'ами под этим условием, поэтому
без него импорт падает на резолве с `ERR_PACKAGE_PATH_NOT_EXPORTED`.

```javascript
// vitest.config.js
export default {
  resolve: {
    conditions: ['testing', 'node', 'node-addons', 'import', 'default'],
  },
};
```

Граница получается структурной: боевой код не импортирует тестовые
подстановки не потому, что так договорились, а потому что Node их не
находит. Node включает условие флагом `--conditions=testing`.

## Вызов через полный пайплайн

```typescript
// src/app.spec.ts
it('отдаёт пользователя через полный пайплайн', async () => {
  await using testApp = await buildTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
  });

  expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
  expect(unwrap(await testApp.call(ListUsers, {}))).toHaveLength(2);
});
```

`buildTest(app, options)` собирает ту же декларацию и проводит
приложение по фазам до `WIRE`: граф построен, политики проверены так же,
как при старте, экземпляры созданы, ресурсы захвачены, таблица маршрутов
создана. Тестовая
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
// src/app.spec.ts
expect(await testApp.call(GetUser, { id: '404' })).toMatchObject({
  isSuccess: false,
  status: 'not_found',
  value: { code: 'not_found:user', details: { id: '404' } },
});
```

## Подмена узлов графа

```typescript
// src/testing.ts
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
// src/app.spec.ts
it('не создаёт узлы, которые нужны только подменённому хранилищу', async () => {
  await using testApp = await buildTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  // Логгер и ридер контекста нужны только боевому хранилищу: после
  // подмены контейнер их не создаёт
  expect(testApp.pruned).toContain('Logger:DbUsersRepository');
  expect(testApp.pruned).toContain('Ctx:requestId');
});
```

`overrides` заменяет узел графа по DI-токену; пара в нём типизирована,
поэтому фейк, не совпадающий с типом DI-токена, не компилируется, а подмена
DI-токена, которого нет в графе, останавливает сборку. Подмена происходит до
создания инстансов, поэтому поддерево, которое больше никому не нужно, из
графа выпадает. От логгера и ридера `Ctx(RequestId)` зависит только боевой
репозиторий: после подмены контейнер их не создаёт. `testApp.pruned`
перечисляет выпавшие узлы.

Соединения с базой в этом списке нет: его делит хранилище outbox'а
([глава 16](./16-durable-events.md)). Выпадает ровно то, что
осталось без единственного потребителя, — и это видно значением, а не
догадкой.

```typescript
// src/app.spec.ts
it('читает размер страницы из конфига', async () => {
  await using testApp = await buildTest(app, {
    config: [
      bind(
        vars({
          API_TOKEN: 'test-token',
          APP_PAGE_SIZE: '1',
          DATABASE_URL: TEST_DATABASE_URL ?? '',
        }),
      ),
    ],
    overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
  });

  expect(unwrap(await testApp.call(ListUsers, {}))).toEqual([alice]);
});
```

`vars(record)` даёт источник конфига из объекта. Привязка `bind(vars({…}))`
в опции `config` — единственный источник тестового прогона: у декларации
привязок нет вовсе. `process.env` не читается и не меняется, поэтому тесты
изолированы и могут идти параллельно.

## Юнит-тест хендлера

```typescript
// src/users/endpoints/create-user.endpoint.spec.ts
describe('CreateUserHandler', () => {
  it('создаёт пользователя и отвечает статусом created', async () => {
    const handler = new CreateUserHandler(inMemoryUsersRepo([alice]));

    const result = await handler.handle({
      name: 'Carol',
      email: 'carol@example.com',
    });

    expect(result).toMatchObject({
      status: 'created',
      value: { id: '2', name: 'Carol' },
    });
  });
});
```

Класс-хендлер, как в главе 5, создаётся через `new` с фейком. Такой тест
проверяет логику хендлера и не проверяет пайплайн, схемы и список
`errors`: это работа теста, который вызывает endpoint через полный
пайплайн.

```bash
yarn test
```

Сервис собран и покрыт тестами. Следующая часть готовит его к
продакшену, начиная с журнала запросов: [9. Видеть каждый запрос в
логе](./09-logging.md).
