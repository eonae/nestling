# servers-implicit

## Why

Список `transports:` сейчас смешивает два вида объявлений: транспорты и
сервер, который владеет сокетом. В `examples/app-with-http` это видно
глазом — `transports: [api, http({ server: api }), mcp({ server: api })]`,
где первый элемент не транспорт. Рядом `users-service` пишет
`transports: [http()]` и сервер не упоминает вовсе. Решение зафиксировано
записью [ideas.md [2026-09-13]](../../../docs/decisions/ideas.md)
«Сервер: `server()`, не перечисляется в `transports:`»; design-доки уже
описывают целевое состояние ([transports.md §4.2](../../../docs/design/transports.md)),
код — прежнее.

## What Changes

- **BREAKING** `httpServer({ name?, … })` переименован в `server({ name?, … })`.
  Имя экземпляра по умолчанию остаётся `'default'`, секция конфигурации
  остаётся семейством `http` (`HTTP_PORT`, `HTTP_ADMIN_PORT`).
- **BREAKING** `httpServerKeys(name?)` переименован в `serverKeys(name?)`.
  Пара имён, которую пишет прикладной код, согласована: `const api = server()`
  и `config: [[dotenv('.env'), serverKeys()]]`.
- **BREAKING** `transports:` принимает только объявления транспортов.
  Тип `TransportEntry` и предикат `isTransport` удаляются из
  `@nestlingjs/app`, поле типизируется `TransportDeclaration`. Объявление
  сервера в списке отвергается на фазе ASSEMBLE сообщением, называющим
  замену.
- Серверы сборки собираются транзитивно: по полю `server` объявлений
  транспортов, с дедупликацией по ссылке. Сервер, на который не ссылается
  ни один транспорт, не создаётся.
- Транспорт без `server` объявляет собственный сервер с именем транспорта —
  поведение не меняется.
- `examples/app-with-http` и рецепт `docs/recipes/mcp.md` переписаны:
  `const api = server()`, `transports: [http({ server: api }), mcp({ server: api })]`.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `http-server-resource`: фабрика называется `server()`, дескриптор ключей —
  `serverKeys()`; объявление сервера не перечисляется в `transports:`, а
  попадает в сборку по ссылке `server` транспорта; сервер без ссылки не
  создаётся.
- `transport-providers`: поле `transports:` содержит только объявления
  транспортов; имена `server()` и `serverKeys()` в требованиях о секции
  сервера.

## Non-goals

- Переименование класса `HttpServer`, семейства DI-токенов `HttpServer$` и
  типов `HttpServerOptions`/`HttpServerSpec`. Они называют реализацию
  поверх `node:http` и секцию `HTTP_*`; `Server` без префикса столкнулось бы
  с `Server` из `node:http` и с `ServerDeclaration` ядра.
- Изменение ключей и формы конфиг-секции сервера: `HTTP_PORT`, `HTTP_HOST`,
  `HTTP_ADMIN_PORT`, `HTTP_ADMIN_HOST` остаются как есть.
- Опции адреса у фабрик. Порт и хост по-прежнему приходят только из
  конфига.
- Суффиксы имён переменных (`api`, `apiServer`) — это change 87
  `naming-conventions`.
- Переименование `assemble` → `build` — это change 86 `terminology`.
  Change пишется поверх текущих имён.

## Impact

Код:

- `@nestlingjs/transport.http`: `src/server.ts` (фабрика), `src/config.ts`
  (`serverKeys`), `src/index.ts` (экспорты), `src/transport.ts` (умолчание
  `server`), спеки пакета.
- `@nestlingjs/app`: `src/transport/declaration.ts` (`TransportEntry`,
  `isTransport`), `src/root/plan.ts` (`collectServers`, нормализация,
  типы `AppSpec`), `src/root/composition.ts`, `src/root/app.ts`,
  `src/root/servers.spec.ts`.
- `@nestlingjs/mcp`: `src/transport.ts` (умолчание `server`), интеграционные
  спеки.
- `@nestlingjs/testing`: `src/unit.ts` (тип поля `transports`).

Документация: `docs/design/config.md` (имя `serverKeys`), `docs/guide/07-config.md`,
`docs/recipes/mcp.md`, README пакетов `transport.http` и `mcp` — вместе с
английскими парами.

Примеры: `examples/app-with-http` (`src/app.ts`, `e2e/helpers/create-test-app.ts`),
`examples/split-nats` (`src/app.ts`).
