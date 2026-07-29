# Приложение с DI: App, модули, классовые endpoints

✅ **Статус: актуально** — сверено с кодом `examples.app-with-http`
(2026-07-29). ⚠️ Описанный здесь стиль деклараций (`@HttpEndpoint`,
классовые endpoints) **уходит из целевого V1** — канон см. в
[design/endpoints.md](../design/endpoints.md), план перевода — roadmap 24
(`endpoint-model`); гайд будет переведён вместе с примером.
Запускаемый код — в
[`packages/examples.app-with-http/`](../../packages/examples.app-with-http/).

Полный уровень фреймворка: DI-контейнер, модули, классовые endpoints
с конструкторной инъекцией, регистрация ручек обходом дерева модулей,
graceful shutdown.
zod в примерах — **один из вариантов**: ядро принимает любую
[Standard Schema](https://standardschema.dev) (valibot, arktype, TypeBox,
Effect Schema …) и валидатором не зависит.

## Классовый endpoint

Один класс = один endpoint. Два декоратора: `@Injectable` объявляет
зависимости (явным массивом токенов), `@HttpEndpoint` — маршрут и контракт.

```typescript
import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

import { basePipeline } from '../../../common/pipelines';
import { ILogger, type ILoggerService } from '../../logger/logger.service';
import { UserService } from '../user.service';

const CreateUserInput = z.object({ name: z.string().min(1), email: z.email() });
const CreateUserOutput = z.object({ id: z.string(), name: z.string(), email: z.string() });
type CreateUserInput = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof CreateUserOutput>;

@Injectable([UserService, ILogger])
@HttpEndpoint('POST', '/api/users', {
  input: CreateUserInput,
  output: CreateUserOutput,
  pipeline: basePipeline,
})
export class CreateUserEndpoint implements IEndpoint {
  constructor(
    private users: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: CreateUserInput): Output<CreateUserOutput> {
    const existing = await this.users.findByEmail(payload.email);
    if (existing) {
      throw Fail.badRequest('Email already taken', { field: 'email' });
    }
    const user = await this.users.create(payload);
    return Ok.created(user, { Location: `/api/users/${user.id}` });
  }
}
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

Пайплайн endpoint'а — значение (`makePipeline` / `compose`), общие
пайплайны экспортируются константами (см.
`examples.app-with-http/src/common/pipelines.ts`). Классы-юниты
(`.pre(WithTracing)` — класс, не инстанс) — обычные провайдеры: App
резолвит их контейнером на старте; если класс не зарегистрирован
в модулях — ошибка старта с именем юнита.

## Модуль

Модуль — plain object через `makeAppModule`: провайдеры + endpoints.
Юниты пайплайнов подключаются через `pipeline` каждого endpoint'а,
не через модуль (классы-юниты регистрируются в `providers`).

```typescript
import { makeAppModule } from '@nestling/app';
import { CreateUserEndpoint, ListUsersEndpoint } from './modules/users/endpoints';
import { UserService } from './modules/users/user.service';

export const UsersModule = makeAppModule({
  name: 'module:users',
  providers: [UserService],
  endpoints: [CreateUserEndpoint, ListUsersEndpoint],
});
```

**`endpoints:` — единственный способ подключить ручку.** Декоратор
`@HttpEndpoint` только пишет метаданные класса: приложение обслуживает
ровно те endpoints, что перечислены в `endpoints:` модуля, переданного
в `App` (вместе с транзитивными `imports`). Импорт файла с декларацией
ничего не регистрирует — глобального реестра нет.

Оба молчаливых режима — ошибки старта:

- класс в `endpoints:` без декоратора эндпоинта;
- класс с декоратором эндпоинта, попавший только в `providers`
  (провайдеры, порождаемые функцией-фабрикой `providers: () => [...]`,
  этой проверке не подлежат — до `build()` их состав неизвестен).

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
в топологическом порядке, обходит дерево `modules` + `imports` и
регистрирует найденные endpoints в транспортах, вешает обработчики
SIGTERM/SIGINT (на выходе — `@OnDestroy` в обратном порядке).
Транспорт, затребованный ручкой, но не переданный в `transports`, —
ошибка старта с именем транспорта, паттерном и модулем-объявителем.
Обход доступен и отдельно, без поднятия приложения:
`discoverEndpoints(modules)` из `@nestling/app`.

## Тестирование endpoint'а

DI не мешает тестам — endpoint тестируется как обычный класс:

```typescript
const endpoint = new CreateUserEndpoint(mockUserService, mockLogger);
const result = await endpoint.handle({ name: 'Alice', email: 'a@b.c' });
```

> Целевой дизайн развивается — см. [decisions/ideas.md](../decisions/ideas.md):
> token families, модули-фабрики с параметром `pipeline`.
