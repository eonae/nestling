# Приложение с DI: App, модули, классовые endpoints

✅ **Статус: актуально** — сверено с кодом `examples.app-with-http`
(2026-07-06). Запускаемый код — в
[`packages/examples.app-with-http/`](../../packages/examples.app-with-http/).

Полный уровень фреймворка: DI-контейнер, модули, классовые endpoints
с конструкторной инъекцией, автоматическая регистрация, graceful shutdown.

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

  async handle(payload: CreateUserInput, meta: {}): Output<CreateUserOutput> {
    const existing = await this.users.findByEmail(payload.email);
    if (existing) {
      throw Fail.badRequest('Email already taken', { field: 'email' });
    }
    const user = await this.users.create(payload);
    return Ok.created(user, { Location: `/api/users/${user.id}` });
  }
}
```

Второй параметр `meta` — поля, накопленные middleware пайплайна; хендлер
декларирует только то, что использует. В `meta` всегда есть
`signal: AbortSignal` — сигнал отмены запроса (взводится при дисконнекте
клиента и при graceful shutdown; отмена кооперативная, ключ `signal`
зарезервирован).

Результаты: `Ok.created / Ok.accepted / Ok.noContent` (или значение напрямую —
обернётся в `Ok`), ошибки — `throw Fail.badRequest / unauthorized / forbidden /
notFound / internalError(...)`.

## Модуль

Модуль — plain object через `makeAppModule`: провайдеры + endpoints.
Middleware подключаются через `pipeline` каждого endpoint'а, не через модуль.

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
в топологическом порядке, регистрирует endpoints из модулей в транспортах,
вешает обработчики SIGTERM/SIGINT (на выходе — `@OnDestroy` в обратном
порядке).

## Тестирование endpoint'а

DI не мешает тестам — endpoint тестируется как обычный класс:

```typescript
const endpoint = new CreateUserEndpoint(mockUserService, mockLogger);
const result = await endpoint.handle({ name: 'Alice', email: 'a@b.c' }, {});
```

> Целевой дизайн развивается — см. [decisions/ideas.md](../decisions/ideas.md):
> token families, модули-фабрики с параметром `pipeline`, pipeline v2.
