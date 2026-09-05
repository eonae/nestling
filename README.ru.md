# Nestling

> TypeScript-фреймворк для бэкенда: меньше, современнее и строже NestJS.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**[🇬🇧 English version](./README.md)**

## Статус

Nestling находится в активной разработке: идёт работа над V1, API меняется.
Используйте в production на свой риск. Рекомендуемая версия Node — 24;
в Node 22 запускайте с флагом `--experimental-async-context-frame`, чтобы
контекст запроса стоил столько же.

## Что это

Nestling собирает приложение из декларативных значений: endpoint'ы,
операции, пайплайны, фичи и модули объявляются обычными константами, а
контейнер зависимостей проверяет весь граф при старте. Основные свойства:

- **Контейнер без магии.** Зависимости объявляются явным списком токенов на
  стандартных ES-декораторах, без `reflect-metadata`. Граф собирается
  целиком при старте: цикл или отсутствующая зависимость останавливают
  сборку, а не запрос.
- **Schema-first.** Схемы `input`, `output` и `errors` endpoint'а задают
  валидацию, типы хендлера, типизированный клиент и документ OpenAPI.
  Валидатор любой: zod, valibot, arktype и всё, что реализует
  [Standard Schema](https://standardschema.dev).
- **Пайплайн без `next()`.** Обработка запроса состоит из плоских фаз
  `.pre`, `.ok`, `.catch` и `.finally`; слои складываются функцией `compose`,
  а политика сборки проверяет, что нужный слой есть у каждого endpoint'а.
- **Ошибки как значения.** Хендлер возвращает `Ok` или `Fail`; список
  возможных отказов входит в декларацию endpoint'а и доходит до клиента.
- **Операции между фичами.** Фича вызывает соседа через операцию, а не через
  его сервис. Тот же код работает в одном процессе и в нескольких, через
  NATS.
- **Один composition root.** `makeApp({ features, plugins, transports,
  config, policies })` объявляет приложение; `assemble(select)` собирает его
  для этого процесса, а `run()` проводит по фазам жизненного цикла.

Принципы, по которым принимаются решения, описаны в
[docs/design/principles.md](./docs/design/principles.md).

## Быстрый старт

```bash
npm install @nestling/app @nestling/transport.http zod
```

```typescript
import { makeApp, makeFeature } from '@nestling/app';
import { http, httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

// Endpoint — значение: адрес, схемы и хендлер в одном объекте
const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }), // `id` берётся из пути
  output: z.object({ id: z.string(), name: z.string() }),
  handler: async ({ id }) => ({ id, name: 'Alice' }),
});

const UsersFeature = makeFeature({ name: 'users', endpoints: [GetUser] });

const app = makeApp({
  features: [UsersFeature],
  transports: [http({ port: 3000 })],
});

await app.assemble().run();
```

Приложение отвечает на `GET /users/42`, проверяет вход по схеме `input` и
останавливается по `SIGTERM`. Схема `output` типизирует хендлер и описывает
ответ; тело ответа сверяет с ней типизированный клиент на приёме. Дальше читайте
[гайд](./docs/guide/README.md): он ведёт от этого файла к приложению из
нескольких фич в нескольких процессах.

## Гайд

| Часть | О чём |
|---|---|
| [1. Первый сервис](./docs/guide/README.md#часть-1-первый-сервис) | endpoint, схемы, отказы, репозиторий, конфиг, тесты |
| [2. Сервис в проде](./docs/guide/README.md#часть-2-сервис-в-проде) | логирование, проверка токена, файлы и потоки, OpenAPI и клиент |
| [3. Приложение растёт](./docs/guide/README.md#часть-3-приложение-растёт) | фичи, операции, события, живая лента, тесты фичи без соседей |
| [4. Разворачивать по частям](./docs/guide/README.md#часть-4-разворачивать-по-частям) | `select`, NATS, совместимость операций |
| [5. Редкие задачи](./docs/guide/README.md#часть-5-редкие-задачи) | webhook, CLI, семейства токенов, источники конфига, эксплуатация, без `assemble` |

## Примеры

| Пример | О чём | Главы гайда |
|---|---|---|
| [`examples.users-service`](./packages/examples.users-service/) | Сервис пользователей: endpoint'ы, репозиторий, конфиг, слои, файлы, OpenAPI, клиент, тесты | 1–10 |
| [`examples.app-with-http`](./packages/examples.app-with-http/) | Тот же сервис из трёх фич: операции, события, SSE, `select`, реестр подписок, снапшот совместимости | 11–15, 17, 18, 22 |
| [`examples.split-nats`](./packages/examples.split-nats/) | Те же фичи в нескольких процессах через NATS | 16 |
| [`examples.simple-cli`](./packages/examples.simple-cli/) | CLI-утилита: команды как endpoint'ы, REPL, поток из stdin | 19 |
| [`examples.container`](./packages/examples.container/) | Контейнер: семейства токенов, источники конфига, reloadable, граф для `viz` | 20, 21, 23 |
| [`examples.simple-http-server`](./packages/examples.simple-http-server/) | HTTP без `assemble`: `makeDispatch` и `serve` | 23 |

## Пакеты

Для автора приложения:

| Пакет | Что делает |
|---|---|
| [`@nestling/app`](./packages/nestling.app/) | Composition root: `assemble`, фичи и плагины, `select`, фазы жизненного цикла, политики |
| [`@nestling/transport.http`](./packages/nestling.transport.http/) | HTTP на `node:http`: `httpEndpoint`, маршрутизация, JSON, NDJSON, SSE, multipart |
| [`@nestling/operations`](./packages/nestling.operations/) | Общее для сервера и клиента: операции, `makeFail`, `Ok`/`Fail`, формы io |
| [`@nestling/config`](./packages/nestling.config/) | Конфигурация секциями со схемами, источники и их привязка, секреты, reloadable |
| [`@nestling/container`](./packages/nestling.container/) | Контейнер зависимостей: токены, провайдеры, семейства токенов, модули, хуки жизненного цикла |
| [`@nestling/pipeline`](./packages/nestling.pipeline/) | Пайплайн обработки запроса, слои, политики, асинхронный контекст |
| [`@nestling/ports`](./packages/nestling.ports/) | Реализация и вызов операций между фичами, шина внутри процесса |
| [`@nestling/testing`](./packages/nestling.testing/) | Тестовый composition root: `assembleTest`, `overrides`, стабы операций, `checkTopologies` |

Транспорты и шина:

| Пакет | Что делает |
|---|---|
| [`@nestling/transport.cli`](./packages/nestling.transport.cli/) | Команды CLI как endpoint'ы: однократный запуск и REPL |
| [`@nestling/transport.nats`](./packages/nestling.transport.nats/) | NATS как шина приложения: операции между процессами, `durable`-доставка |
| [`@nestling/transport`](./packages/nestling.transport/) | Интерфейс транспорта и `makeDispatch` для запуска без `assemble` |
| [`@nestling/streams`](./packages/nestling.streams/) | `Topic<T>` и комбинаторы потоков на `AsyncIterable` |

Инструменты и сателлиты:

| Пакет | Что делает |
|---|---|
| [`@nestling/client`](./packages/nestling.client/) | Типизированный HTTP-клиент из операций для фронтенда и других сервисов |
| [`@nestling/openapi`](./packages/nestling.openapi/) | Документ OpenAPI 3.1 из деклараций endpoint'ов |
| [`@nestling/openapi.zod`](./packages/nestling.openapi.zod/) | Конвертер схем zod для `@nestling/openapi` |
| [`@nestling/subscriptions`](./packages/nestling.subscriptions/) | Реестр активных подписок: список, принудительное закрытие, наблюдение |
| [`@nestling/viz`](./packages/nestling.viz/) | Интерактивная визуализация графа зависимостей в браузере |
| [`@nestling/eslint-plugin`](./packages/nestling.eslint-plugin/) | Правила ESLint: граница модуля по баррелю, подсказки по декларациям endpoint'ов |
| [`@nestling/models`](./packages/nestling.models/) | Модели ввода-вывода на zod со сверкой с TypeScript-типом |

## Документация

Точка входа — [`docs/README.md`](./docs/README.md). Папка определяет статус
документа:

- [`docs/guide/`](./docs/guide/README.md) — гайд по текущему API, главы
  сверены с кодом примеров;
- [`docs/design/`](./docs/design/README.md) — целевое состояние V1, полное
  описание API;
- [`docs/decisions/`](./docs/decisions/ideas.md) — журнал решений: что, когда
  и почему;
- [`docs/glossary.md`](./docs/glossary.md) — термины и правила их написания.

Актуальное состояние кода описывают README пакетов.

## Разработка

```bash
yarn install
yarn verify          # build + typecheck + lint + test по всем пакетам
yarn docs:audit      # проверка консистентности документации
yarn docs:preview    # сборка HTML-превью документации
```

Монорепозиторий на Yarn workspaces и Nx: пакеты лежат в `packages/`,
документация в `docs/`.

## Участие

Это персональный проект, но вопросы и предложения приветствуются: откройте
issue.

## Лицензия

MIT © 2025
