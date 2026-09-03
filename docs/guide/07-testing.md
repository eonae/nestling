# 7. Убедиться, что работает, без запуска сервера

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-03).
> Целевое описание: [design/testing.md](../design/testing.md). Почему так:
> запись [ideas.md](../decisions/ideas.md) «[2026-07-10] Пакет
> тестирования (`@nestling/testing`)».

## Задача

Тесты должны вызывать endpoint'ы через тот же пайплайн, что и запросы по
сети, но без сокета, без базы и без переменных окружения. Отдельно нужен
быстрый юнит-тест хендлера, в котором нет ни контейнера, ни приложения.

## Решение

### Одна декларация для точки входа и тестов

```typescript
// packages/examples.users-service/src/app.ts
export const app = makeApp({
  features: [UsersFeature],
  plugins: [
    // …
  ],
  transports: [http()],
  policies: [
    // …
  ],
});
```

Тест должен собирать то же приложение, что и `main.ts`: те же фичи,
плагины и политики. Поэтому декларация лежит в отдельном файле, а
`main.ts` и тесты импортируют одно и то же значение `app`. Словарь
состава в тест не копируется: `assembleTest` принимает саму декларацию.

Тест задаёт только то, что относится к прогону: подмены, выбор фич и
конфиг.

```typescript
// packages/examples.users-service/src/app.spec.ts
import { app } from './app';

/** Конфиг теста: объект вместо `process.env` */
const testConfig = vars({ API_TOKEN: 'test-token' });
```

Транспорты подменять не нужно: тестовая сборка не выполняет START,
поэтому сокет не открывается и порт не занимается.

### Вызов через полный пайплайн

```typescript
// packages/examples.users-service/src/app.spec.ts
it('отдаёт пользователя через полный пайплайн', async () => {
  await using testApp = await assembleTest(app, {
    overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
  });

  expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
  expect(unwrap(await testApp.call(ListUsers, {}))).toHaveLength(2);
});
```

`assembleTest(app, options)` собирает ту же декларацию и проводит
приложение по фазам до `WIRE`: граф построен, политики проверены,
`@OnInit` выполнен, таблица маршрутов создана. Сокет не открывается,
обработчики сигналов не ставятся. `await using` закрывает приложение в
конце теста. Переменная названа `testApp`, чтобы не затенять `app` из
`app.ts`.

`testApp.call(Endpoint, payload)` вызывает endpoint по значению декларации.
Запрос проходит все слои пайплайна, проверку входа по схеме и проверку
отказов по `errors`. Разбор пути, query и тела не выполняется: `call`
принимает готовый payload. `unwrap` возвращает значение успешного ответа
или бросает ошибку с категорией и кодом отказа.

### Ответ с отказом

```typescript
// packages/examples.users-service/src/app.spec.ts
expect(await testApp.call(GetUser, { id: '404' })).toMatchObject({
  isSuccess: false,
  status: 'not_found',
  value: { code: 'not_found:user', details: { id: '404' } },
});
```

Ответ `testApp.call` несёт `isSuccess`, `status` и `value`. Для отказа в
`value` лежат код и детали, а `status` равен категории кода.

### Подмена хранилища

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

Фейк реализует интерфейс `UsersRepository` поверх массива. Он лежит
рядом с интерфейсом: изменился интерфейс, и фейк перестал
компилироваться в том же коммите.

```typescript
// packages/examples.users-service/src/app.spec.ts
it('не создаёт узлы, которые нужны только подменённому хранилищу', async () => {
  await using testApp = await assembleTest(app, {
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  // Соединение с базой нужно только боевому хранилищу: после подмены
  // контейнер его не создаёт, и `@OnInit` не вызывается
  expect(testApp.pruned).toContain('Database');
});
```

`overrides` заменяет узел графа по токену. Подмена происходит до создания
инстансов, поэтому поддерево, которое больше никому не нужно, из графа
выпадает. От `Database` зависит только боевой репозиторий: после
подмены контейнер её не создаёт, и соединение не открывается. `testApp.pruned`
перечисляет выпавшие узлы.

### Конфиг без `process.env`

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

`vars(record)` даёт источник конфига из объекта. `process.env` не
читается и не меняется, поэтому тесты изолированы и могут идти
параллельно.

### Юнит-тест хендлера

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

Класс-хендлер из главы 4 создаётся через `new` с фейком. Такой тест
проверяет логику хендлера и не проверяет пайплайн, схемы и список
`errors`: это работа app-теста.

### Запуск

```bash
yarn workspace examples.users-service test
```

Тесты слоя проверки токена, которые тоже лежат в `app.spec.ts`,
разбирает глава 9.

## Что гарантирует фреймворк

- Пара в `overrides` типизирована: фейк, не совпадающий с типом токена,
  не компилируется. Подмена токена, которого нет в графе, останавливает
  сборку.
- Политики декларации проверяются в тесте так же, как при старте.
  Тестовая сборка их не ослабляет: приложение, которое не собирается в
  бою, не собирается и в тесте.
- Конфиг теста заменяет привязку источников декларации целиком, поэтому
  боевой источник в тесте не инициализируется.
- Вход `testApp.call` проверяет тот же рантайм, что и при запросе по сети,
  поэтому `testApp.call` и HTTP дают один результат.

## Как проверить

Глава целиком состоит из тестов. Файл `app.spec.ts` покрывает пайплайн,
отказы, подмену и конфиг; файл `create-user.endpoint.spec.ts` покрывает
хендлер отдельно.

## Пока не нужно

- Заглушка операции соседней фичи через `stubs` и вызов события через
  `testApp.emit`: глава 15.
- Подмена переменной контекста через `contextValue`: глава 15.
- Матрица сборок `checkTopologies`: глава 16.
- Подмена семейства токенов через `familyOverride`: глава 21.

## Запускаемый код

- `packages/examples.users-service/src/app.ts`
- `packages/examples.users-service/src/app.spec.ts`
- `packages/examples.users-service/src/testing.ts`
- `packages/examples.users-service/src/users/endpoints/create-user.endpoint.spec.ts`

```bash
yarn workspace examples.users-service test
```

## Дальше

Сервис собран и покрыт тестами. Часть 2 готовит его к продакшену,
начиная с журнала запросов: [8. Видеть каждый запрос в
логе](./08-logging.md).
