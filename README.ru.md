# Nestling

> TypeScript-фреймворк для бэкенда: меньше, современнее и строже NestJS.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/LICENSE)

**[🇬🇧 English version](./README.md)**

## Статус

Nestling находится в активной разработке: идёт работа над V1, API меняется.
Используйте в production на свой риск.

## Что это

Nestling собирает приложение из декларативных значений: endpoint'ы,
контракты, пайплайны и модули объявляются обычными константами, а
контейнер зависимостей проверяет весь граф при старте. Основные свойства:

- **Контейнер без магии.** Зависимости объявляются явным списком токенов на
  стандартных ES-декораторах, без `reflect-metadata`. Граф собирается
  целиком при старте: цикл или отсутствующая зависимость — ошибка сборки,
  а не рантайма.
- **Schema-first.** Схемы `input`, `output` и `errors` endpoint'а задают
  валидацию, типы хендлера, типизированные клиенты и документ OpenAPI.
  Валидатор любой: zod, valibot, arktype — всё, что реализует
  [Standard Schema](https://standardschema.dev).
- **Пайплайн без `next()`.** Обработка запроса — плоские фазы `.pre`, `.ok`,
  `.catch`, `.finally`; слои складываются функцией `compose`.
- **Ошибки как значения.** Хендлер возвращает `Ok` или `Fail`; список
  возможных отказов — часть контракта endpoint'а.
- **Контракты между фичами.** Фича вызывает соседа через контракт, а не через
  его сервис. Тот же код работает в одном процессе и в нескольких, через NATS.
- **Один composition root.** `assemble({ modules, features, transports,
  config, policies })` собирает приложение и проводит его по фазам
  жизненного цикла.

Принципы, по которым принимаются решения, описаны в
[docs/design/principles.md](./docs/design/principles.md).

## Быстрый старт

```bash
npm install @nestling/app @nestling/container @nestling/pipeline @nestling/transport.http zod
```

```typescript
import { assemble, makeAppModule } from '@nestling/app';
import { Ok } from '@nestling/contracts';
import { http, httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

// Endpoint — значение: транспорт, адрес, схемы и хендлер в одном объекте
const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),          // { id } берётся из пути
  output: z.object({ id: z.string(), name: z.string() }),
  handle: async ({ id }) => new Ok({ id, name: 'Alice' }),
});

const UsersModule = makeAppModule({
  name: 'module:users',
  endpoints: [GetUser],
});

await assemble({
  modules: [UsersModule],
  transports: [http({ port: 3000 })],
}).run();
```

Приложение отвечает на `GET /users/42`, валидирует вход и выход по схемам и
корректно останавливается по `SIGTERM`. Дальше — гайды в
[docs/guides/](./docs/README.md#guides--по-текущему-api).

## Пакеты

Ядро:

| Пакет | Что делает |
|---|---|
| [`@nestling/container`](./packages/nestling.container/) | Контейнер зависимостей: токены, провайдеры, семейства токенов, модули, хуки жизненного цикла |
| [`@nestling/contracts`](./packages/nestling.contracts/) | Декларации, общие для сервера и клиента: `makeContract`, `defineFail`, `Ok`/`Fail`, формы io |
| [`@nestling/pipeline`](./packages/nestling.pipeline/) | Пайплайн обработки запроса и декларации endpoint'ов |
| [`@nestling/app`](./packages/nestling.app/) | Composition root: `assemble`, фичи и `select`, фазы жизненного цикла, политики |
| [`@nestling/config`](./packages/nestling.config/) | Конфигурация секциями со схемами, источники и их привязка, секреты |
| [`@nestling/ports`](./packages/nestling.ports/) | Реализация и вызов контрактов между фичами, in-process шина |
| [`@nestling/streams`](./packages/nestling.streams/) | `Topic<T>` и комбинаторы потоков на `AsyncIterable` |
| [`@nestling/transport`](./packages/nestling.transport/) | Интерфейс транспорта и `makeDispatch` |

Транспорты:

| Пакет | Что делает |
|---|---|
| [`@nestling/transport.http`](./packages/nestling.transport.http/) | HTTP на `node:http`: маршрутизация, JSON, NDJSON, SSE, multipart |
| [`@nestling/transport.cli`](./packages/nestling.transport.cli/) | Команды CLI как endpoint'ы: однократный запуск и REPL |
| [`@nestling/transport.nats`](./packages/nestling.transport.nats/) | NATS как шина приложения: контракты между процессами, `durable`-доставка |

Инструменты:

| Пакет | Что делает |
|---|---|
| [`@nestling/client`](./packages/nestling.client/) | Типизированный HTTP-клиент из контрактов для фронтенда и других сервисов |
| [`@nestling/openapi`](./packages/nestling.openapi/) | Документ OpenAPI 3.1 из деклараций endpoint'ов |
| [`@nestling/openapi.zod`](./packages/nestling.openapi.zod/) | Конвертер схем zod для `@nestling/openapi` |
| [`@nestling/testing`](./packages/nestling.testing/) | Тестовый composition root: `assembleTest`, `overrides`, заглушки контрактов, `checkTopologies` |
| [`@nestling/subscriptions`](./packages/nestling.subscriptions/) | Реестр активных подписок: список, принудительное закрытие, наблюдение |
| [`@nestling/viz`](./packages/nestling.viz/) | Интерактивная визуализация графа зависимостей в браузере |
| [`@nestling/eslint-plugin`](./packages/nestling.eslint-plugin/) | Подсказки ESLint для деклараций endpoint'ов |
| [`@nestling/models`](./packages/nestling.models/) | Модели ввода-вывода на zod со сверкой с TypeScript-типом |

## Примеры

| Пример | О чём | Гайд |
|---|---|---|
| [`examples.simple-app`](./packages/examples.simple-app/) | Контейнер без транспорта: модули, семейства токенов, конфиг | [di-token-families](./docs/guides/di-token-families.md), [config](./docs/guides/config.md) |
| [`examples.simple-http-server`](./packages/examples.simple-http-server/) | HTTP без DI: endpoint'ы, валидация, потоки | [http-functional](./docs/guides/http-functional.md) |
| [`examples.app-with-http`](./packages/examples.app-with-http/) | Полное приложение: `assemble`, фичи, контракты, OpenAPI, тесты | [http-app-di](./docs/guides/http-app-di.md), [composition](./docs/guides/composition.md), [ports](./docs/guides/ports.md) |
| [`examples.simple-cli`](./packages/examples.simple-cli/) | CLI-транспорт | [cli](./docs/guides/cli.md) |
| [`examples.split-nats`](./packages/examples.split-nats/) | Одно приложение в нескольких процессах через NATS | [ports](./docs/guides/ports.md) |

## Документация

Точка входа — [`docs/README.md`](./docs/README.md). Папка определяет статус
документа:

- [`docs/guides/`](./docs/README.md#guides--по-текущему-api) — гайды по текущему
  API, сверены с кодом примеров;
- [`docs/design/`](./docs/design/README.md) — целевое состояние V1, полное
  описание API;
- [`docs/decisions/`](./docs/decisions/ideas.md) — журнал решений: что, когда
  и почему;
- [`docs/glossary.md`](./docs/glossary.md) — термины и правила их написания.

Актуальное состояние кода описывают README пакетов.

## Разработка

```bash
yarn install
yarn verify          # build + lint + test по всем пакетам
yarn docs:audit      # проверка консистентности документации
yarn docs:preview    # сборка HTML-превью документации
```

Монорепозиторий на Yarn workspaces и Nx: пакеты лежат в `packages/`,
документация — в `docs/`.

## Участие

Это персональный проект, но вопросы и предложения приветствуются: откройте
issue.

## Лицензия

MIT © 2025
