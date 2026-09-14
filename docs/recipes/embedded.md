# Приложение внутри чужого процесса

> Гайд по текущему API; сверено с кодом `7e698779` (2026-09-14).
> Целевое описание: [design/transports.md](../design/transports.md) §4.3,
> [design/composition.md](../design/composition.md) §1. Почему так: запись
> [ideas.md](../decisions/ideas.md) «Разбор обзоров d/10 и d/13»
> [2026-09-12], пункт 4.

Процессом владеет кто-то другой: сокет открывает Next.js, Express или
тестовый прогон. Приложение Nestling при этом остаётся целым — фичи,
контейнер, фазы, — но сокета не открывает и отдаёт наружу обработчик
запроса.

Даёт его транспорт `adapter()`. Он объявляется вместо `http()`, тем же
именем экземпляра и с теми же опциями разбора. Декларации `httpEndpoint`
переезжают на него без единой правки.

## Роут Next.js

```typescript
// src/app/api/[[...path]]/route.ts
import { adapter, toFetchHandler } from '@nestlingjs/transport.http';

const app = makeApp({
  features: [Users],
  transports: [adapter()],
}).assemble();

await app.run({ signals: false });

const handler = toFetchHandler(app);

export const GET = handler;
export const POST = handler;
```

`toFetchHandler(app, { name? })` отдаёт `(request: Request) =>
Promise<Response>` — ровно ту форму, которую ждут роуты Next.js, Hono и
Elysia. Функция синхронная: она берёт готовый экземпляр адаптера из карты
`app.transports` и возвращает его обработчик.

Запрос, не совпавший ни с одним паттерном деклараций, получает `404`.
Приложение обслуживает те пути, которые объявили его endpoint'ы, и
срезать префикс монтирования (`/api`) — дело хозяина процесса.

Формы io работают все: `value`, `stream`, `events`, `multipart` и
`rawBody`. Потоковый ответ возвращается сразу, как только известен статус,
поэтому `Response` с телом-потоком доступен вызывающему до конца потока.

## Роут Express

```typescript
// src/server.ts
import { adapter, toNodeHandler } from '@nestlingjs/transport.http';

const app = makeApp({
  features: [Users],
  transports: [adapter()],
}).assemble();

await app.run({ signals: false });

const handler = toNodeHandler(app);

server.use((request, response, next) => {
  // `false` означает «маршрут не приложения»: дальше идёт своя
  // маршрутизация хозяина
  void handler(request, response).then((taken) => {
    if (!taken) {
      next();
    }
  });
});
```

`toNodeHandler(app, { name? })` отдаёт `(req, res) => Promise<boolean>`.
Признак `false` и отличает эту форму от `fetch`: ответ не отправлен,
запрос свободен, и хозяин продолжает свою цепочку. Так же работает вторая
половина приложения на Fastify и на голом `node:http`.

## Подъём и остановка

Приложение поднимает и останавливает хозяин процесса. Скрытого подъёма
первым запросом нет: до `run()` обработчика не существует, и обе функции
отказывают с сообщением, называющим `run()`.

```typescript
await app.run({ signals: false });

// … и там, где хозяин завершает работу
await app.close();
```

**`signals: false` обязателен для встроенного приложения.** Без опции
`run()` подписывается на `SIGTERM` и `SIGINT`, а подписка на `SIGINT`
отменяет завершение чужого процесса по Ctrl+C. Остальные фазы идут
одинаково при любом значении опции.

## Адрес клиента

Сокета у формы `fetch` нет, поэтому `ctx.http.ip` пуст. Адрес клиента
приходит заголовком от того, кто стоит перед процессом:

```typescript
pipeline: makePipeline().pre(withClientIp),
```

Юнит `withClientIp` читает `x-forwarded-for` и кладёт адрес в контекст
запроса. На форме `node:http` доступны оба пути: адрес сокета и заголовок.

## Границы

Рантайм помимо Node в пакет не входит. Разбор `multipart` идёт через
`busboy`, тело собирается в `Buffer`, а источник формы `fetch`
заворачивает тело запроса в поток `node:stream`. Сборка под Workers или
Deno остаётся отдельной работой.

Приложение без `makeApp` — другая задача, и решается она другими
примитивами: [«Без `makeApp`»](./standalone.md) собирает транспорт,
сервер и `dispatch` руками, без фаз и контейнера приложения.
