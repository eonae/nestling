# 1. Поднять сервис, который отвечает на запрос

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-03).
> Целевое описание: [design/composition.md](../design/composition.md),
> [design/endpoints.md](../design/endpoints.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-09-02] Модель композиции: фича,
> плагин, операция» и «[2026-07-13] Endpoint-декларации: per-transport
> конструкторы, `deps`-инжект, формы хендлера».

## Задача

Вам нужен HTTP-сервис, который отвечает JSON на `GET /health`. Он должен
стартовать одной командой и останавливаться по `SIGTERM` без обрыва
запросов, которые уже обрабатываются.

## Решение

### Endpoint, фича и корень в одном файле

```typescript
// шаг главы 1; итоговая версия: packages/examples.users-service/src/main.ts
import { assemble, makeFeature } from '@nestling/app';
import { http, httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: z.object({ status: z.string() }),
  handle: async () => ({ status: 'up' }),
});

const UsersFeature = makeFeature({ name: 'users', endpoints: [Health] });

await assemble({
  features: [UsersFeature],
  transports: [http()],
}).run();
```

Приложение состоит из трёх значений.

Декларация endpoint'а `Health` описывает адрес, схему ответа и хендлер.
`httpEndpoint` собирает паттерн из `method` и `path`: `GET /health`. Схема
`output` задаёт форму ответа и тип возвращаемого значения хендлера.
Хендлер возвращает обычный объект, транспорт сериализует его в JSON.

Фича `UsersFeature` перечисляет endpoint'ы под своим именем. Пока фича
одна, и приложение выглядит так, будто фич нет. Что даёт деление на фичи,
показывает глава 11.

Composition root `assemble` получает список фич и список транспортов.
`http()` объявляет HTTP-транспорт: порт и хост он читает из своей секции
конфига, по умолчанию `3000` и `0.0.0.0`. Вызов `run()` собирает граф,
проверяет его, открывает сокет и ставит обработчики `SIGTERM` и `SIGINT`.
По сигналу транспорт перестаёт принимать новые запросы, сообщает
текущим об отмене через `meta.signal` и закрывается, когда они
завершатся.

### Как это лежит в примере

В итоговом примере каждое из трёх значений живёт в своём файле.

```typescript
// packages/examples.users-service/src/users/endpoints/health.endpoint.ts
export const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: z.object({ status: z.string() }),
  detached:
    'проба балансировщика: строка аудита на каждый запрос заслоняет полезные записи',
  doc: { hidden: 'служебная проба, не часть публичного API' },
  handle: async () => ({ status: 'up' }),
});
```

Поля `detached` и `doc` относятся к политикам сборки и документу
OpenAPI. Их объясняют главы 8 и 10.

```typescript
// packages/examples.users-service/src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    // … главы 4, 7 и 8
  ],
  endpoints: [
    Health,
    // … главы 2, 3 и 9
  ],
});
```

```typescript
// packages/examples.users-service/src/app.ts
export const appSpec = {
  features: [UsersFeature],
  plugins: [
    // … глава 10
  ],
  transports: [http()],
  policies: [
    // … глава 8
  ],
};
```

Словарь сборки вынесен в `app.ts`, потому что его читают и точка входа,
и тесты. Зачем тестам тот же словарь, объясняет глава 6.

```typescript
// packages/examples.users-service/src/main.ts
async function main(): Promise<void> {
  await assemble(appSpec).run();

  console.log('users-service: GET /health, GET /users, GET /openapi.json');
}

main().catch((error: unknown) => {
  console.error('failed to start:', error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
```

### Запуск

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
```

Переменная `API_TOKEN` нужна итоговому примеру: секция конфига объявляет
её обязательной, и без неё приложение не стартует. Что это значит и
откуда берутся остальные значения, объясняет глава 5. Пока задайте любую
строку.

При старте приложение печатает состав сборки:

```
[nestling] features: users; transports: http
[nestling] detached from policies: GET /health (http) — проба балансировщика: …
users-service: GET /health, GET /users, GET /openapi.json
```

Проверьте ответ:

```bash
curl localhost:3000/health
# {"status":"up"}
```

## Что гарантирует фреймворк

- Путь проверяется в момент создания декларации. Пустой путь, путь без
  ведущего `/` и повторяющийся path-параметр дают ошибку на этапе
  импорта модуля, а не на старте приложения.
- Тип возвращаемого значения хендлера сверяется со схемой `output` в точке
  декларации. Хендлер, который возвращает объект другой формы, не
  компилируется.
- Сокет открывается после того, как граф собран и проверен. Транспорт
  не может принять запрос раньше, чем готова таблица маршрутов: у него нет
  метода запуска без неё.

## Как проверить

Тесты, которые вызывают endpoint без открытия сокета, появляются в
главе 6. Для первой главы достаточно `curl` из раздела «Запуск».

## Пока не нужно

- Пайплайн, то есть код до и после хендлера: глава 7.
- Зависимости хендлера и провайдеры: глава 4.
- Конфиг и переменные окружения: глава 5.
- Поля `detached` и `doc` у `Health`: главы 8 и 10.

## Запускаемый код

- `packages/examples.users-service/src/users/endpoints/health.endpoint.ts`
- `packages/examples.users-service/src/users.feature.ts`
- `packages/examples.users-service/src/app.ts`
- `packages/examples.users-service/src/main.ts`

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl localhost:3000/health
```

## Дальше

Сервис отвечает на запрос без параметров. Следующая глава принимает
данные от клиента и проверяет их: [2. Принять данные и не пропустить
мусор](./02-input.md).
