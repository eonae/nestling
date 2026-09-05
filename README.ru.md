# Nestling

> TypeScript-фреймворк для бэкенда: меньше, современнее и строже NestJS.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**[🇬🇧 English version](./README.md)**

## Статус

Nestling находится в активной разработке: идёт работа над V1, API меняется.
Используйте в production на свой риск. Требуется Node 24.

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

## Документация

Точка входа — [`docs/README.md`](./docs/README.md): карта папок, список
пакетов и правила ведения документации. Папка определяет статус документа:

- [`docs/guide/`](./docs/guide/README.md) — гайд по текущему API; оглавление
  называет все главы, части, которые они образуют, и пример, с которым
  сверена каждая глава;
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
yarn docs:build      # сборка HTML-сайта документации
```

Монорепозиторий на Yarn workspaces и Nx: пакеты лежат в `packages/`,
документация в `docs/`.

## Участие

Это персональный проект, но вопросы и предложения приветствуются: откройте
issue.

## Лицензия

MIT © 2025
