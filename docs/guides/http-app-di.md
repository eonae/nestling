# Приложение с DI: App, модули, декларации endpoint'ов

✅ **Статус: актуально** — сверено с кодом `examples.app-with-http`
(2026-07-30). Канон деклараций описан в
[design/endpoints.md](../design/endpoints.md).
Запускаемый код — в
[`packages/examples.app-with-http/`](../../packages/examples.app-with-http/).

Полный уровень фреймворка: DI-контейнер, модули, декларации-значения
с инъекцией зависимостей в хендлер, регистрация ручек обходом дерева
модулей, graceful shutdown.
zod в примерах — **один из вариантов**: ядро принимает любую
[Standard Schema](https://standardschema.dev) (valibot, arktype, TypeBox,
Effect Schema …) и валидатором не зависит.

## Декларация — значение

Ручка объявляется конструктором своего транспорта: `httpEndpoint` для
HTTP, `cliEndpoint` для CLI. Транспортный словарь (`method`, `path`)
легален только здесь; пайплайн и хендлер остаются транспорт-слепыми.
Декораторов эндпоинта и интерфейса `IEndpoint` нет — сверка сигнатуры
`handle` со схемами `input`/`output` идёт в точке декларации.

## DI хендлера: `deps` + каррированная фабрика

Первая форма подключения зависимостей: `deps` — явный массив токенов,
`handle` — фабрика, возвращающая хендлер. Внешний вызов происходит **один
раз** при гашении зависимостей на старте App; замыкание играет роль
инстанса.

```typescript
import type { Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

import { basePipeline } from '../../../common/pipelines';
import { ILogger, type ILoggerService } from '../../logger/logger.service';
import { UserService } from '../user.service';

const CreateUserInput = z.object({ name: z.string().min(1), email: z.email() });
const CreateUserOutput = z.object({ id: z.string(), name: z.string(), email: z.string() });
type CreateUserInput = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof CreateUserOutput>;

export const createUserHandler =
  (users: UserService, logger: ILoggerService) =>
  async (payload: CreateUserInput): Output<CreateUserOutput> => {
    const existing = await users.findByEmail(payload.email);
    if (existing) {
      throw Fail.badRequest('Email already taken', { field: 'email' });
    }
    const user = await users.create(payload);
    return Ok.created(user, { Location: `/api/users/${user.id}` });
  };

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/api/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: createUserHandler,
});
```

Хендлер может объявить второй параметр `meta` — поля, накопленные pre-юнитами
пайплайна; декларирует только то, что использует (в примере он не нужен,
поэтому опущен). В `meta` всегда есть
`signal: AbortSignal` — сигнал отмены запроса (взводится при дисконнекте
клиента и при graceful shutdown; отмена кооперативная, ключ `signal`
зарезервирован).

Результаты: `Ok.created / Ok.accepted / Ok.noContent` (или значение напрямую —
обернётся в `Ok`), ошибки — `throw Fail.badRequest / unauthorized / forbidden /
notFound / internalError(...)`.

## DI хендлера: класс-хендлер

Вторая форма — класс с `@Injectable` и методом `handle`. Это **форма
подключения DI, а не второй стиль деклараций**: сама декларация остаётся
тем же значением. `implements` не нужен.

```typescript
import { Injectable } from '@nestling/container';

@Injectable([UserService, ILogger])
export class SearchUsersHandler {
  constructor(
    private readonly users: UserService,
    private readonly logger: ILoggerService,
  ) {}

  async handle(payload: SearchUsersInput): Output<SearchUsersOutput> {
    /* ... */
  }
}

export const SearchUsers = httpEndpoint({
  method: 'GET',
  path: '/api/users/search',
  input: SearchUsersInput,
  output: SearchUsersOutput,
  pipeline: basePipeline,
  handle: SearchUsersHandler,
});
```

Класс-хендлер — обычный провайдер: его **надо перечислить в `providers:`**
модуля, как любую другую зависимость. Автоматической регистрации нет —
это была бы асимметрия «класс волшебный, токен нет».

Пайплайн endpoint'а — значение (`makePipeline` / `compose`), общие
пайплайны экспортируются константами (см.
`examples.app-with-http/src/common/pipelines.ts`). Классы-юниты
(`.pre(WithTracing)` — класс, не инстанс) — обычные провайдеры: App
резолвит их контейнером на старте вместе с `deps`; если класс не
зарегистрирован в модулях — ошибка старта с именем зависимости, паттерном
ручки и модулем-объявителем.

## Модуль

Модуль — plain object через `makeAppModule`: провайдеры + декларации.
В `providers` идут зависимости хендлеров (токены из `deps`, классы-хендлеры,
классы-юниты пайплайнов); в `endpoints` — сами декларации-значения.
`makeAppModule` ничего в `providers` не подмешивает: инстанцировать
декларацию не нужно.

```typescript
import { makeAppModule } from '@nestling/app';
import { CreateUser, SearchUsers, SearchUsersHandler } from './modules/users/endpoints';
import { UserService } from './modules/users/user.service';

export const UsersModule = makeAppModule({
  name: 'module:users',
  providers: [UserService, SearchUsersHandler],
  endpoints: [CreateUser, SearchUsers],
});
```

**`endpoints:` — единственный способ подключить ручку.** Создание
декларации не имеет побочных эффектов: приложение обслуживает ровно те
ручки, что перечислены в `endpoints:` модуля, переданного в `App` (вместе
с транзитивными `imports`). Импорт файла с декларацией ничего не
регистрирует — глобального реестра нет.

Элемент `endpoints:`, не являющийся декларацией (положили сервис,
конфиг или `undefined`), — ошибка старта с именем модуля и индексом
элемента: декларация помечена symbol-брендом, и молчаливого пропуска нет.

## Bootstrap

```typescript
import { App } from '@nestling/app';
import { HttpTransport } from '@nestling/transport.http';
import { LoggerModule } from './modules/logger/logger.module';
import { UsersModule } from './users.module';

const app = new App({
  modules: [LoggerModule, UsersModule],
  transports: { http: new HttpTransport({ port: 3000 }) },
});

await app.run(); // build контейнера + init-хуки + listen + graceful shutdown
```

`App.run()` делает всё: собирает контейнер, запускает `@OnInit`-хуки
в топологическом порядке, обходит дерево `modules` + `imports`, гасит
зависимости найденных деклараций контейнером (`endpoint.resolve(resolver)`)
и регистрирует исполнимые значения в транспортах, вешает обработчики
SIGTERM/SIGINT (на выходе — `@OnDestroy` в обратном порядке).
Транспорт, затребованный ручкой, но не переданный в `transports`, —
ошибка старта с именем транспорта, паттерном и модулем-объявителем.
Обход доступен и отдельно, без поднятия приложения:
`discoverEndpoints(modules)` из `@nestling/app`.

## Тестирование хендлера

DI не мешает тестам — ни контейнера, ни транспорта, ни импортов из
`@nestling/app` не нужно:

```typescript
// каррированная фабрика — вызов с фейками
const handle = createUserHandler(mockUserService, mockLogger);
const result = await handle({ name: 'Alice', email: 'a@b.c' });

// класс-хендлер — обычный new
const handler = new SearchUsersHandler(mockUserService, mockLogger);
const found = await handler.handle({ q: 'Alice' });
```

Декларацию можно погасить и целиком — `CreateUser.resolve([users, logger])`
возвращает **новое** исполнимое значение, исходное остаётся нетронутым.

> Целевой дизайн развивается — см. [decisions/ideas.md](../decisions/ideas.md):
> token families, модули-фабрики с параметром `pipeline`.
