# Отдать операции агенту по MCP

> Гайд по текущему API; сверено с кодом `app-with-http` (2026-09-13).
> Целевое описание: [design/transports.md](../design/transports.md) §8,
> [design/operations.md](../design/operations.md) §1.8. Почему так: запись
> [ideas.md](../decisions/ideas.md) «Разбор обзоров d/10 и d/13», пункт 7.

У сервиса уже есть HTTP-API, и те же операции нужно отдать агенту по
Model Context Protocol. Второго описания писать не нужно: имя, схемы,
отказы и текст для агента берутся с декларации, которая обслуживает
запросы.

## Транспорт на том же сокете

MCP — входящий протокол, поэтому он объявляется транспортом рядом с
`http()`. Сервер объявляется отдельно и передаётся обоим: сокет остаётся
один.

```typescript
// examples/app-with-http/src/app.ts
export const api = httpServer();

export const app = makeApp({
  features: [UsersFeature, QuotasFeature, OpsFeature],
  transports: [
    api,
    http({ server: api }),
    mcp({
      server: api,
      info: { name: 'users-service', version: '1.0.0' },
      converters: openapiOptions.converters,
    }),
  ],
});
```

`info` уходит агенту в ответе на `initialize`: по имени и версии он
показывает пользователю, у кого просит разрешение на вызов. `converters`
переводят схемы в JSON Schema — тот же список, что у документа OpenAPI.
Путь задаёт `path`, по умолчанию это `POST /mcp`.

## Инструмент из объявленной операции

`mcpTool.implement` читает операцию: схемы, отказы и секцию `doc`. Имя
инструмента выводится из имени операции заменой точек на подчёркивания,
описание — из `doc.description`, затем `doc.summary`. Хендлер тот же
класс, что обслуживает HTTP-декларацию.

```typescript
// examples/app-with-http/src/features/users/tools/get-user.tool.ts
export const GetUserTool = mcpTool.implement(GetUserOperation, {
  annotations: { readOnlyHint: true },
  pipeline: observability,
  handler: GetUserHandler,
});
```

`annotations` — подсказки агенту о характере инструмента. Из декларации
они не выводятся: HTTP-метод сказал бы про эффект неправду, потому что
`POST /users/search` меняет данные не больше, чем `GET`.

Инструмент кладётся в `endpoints:` фичи рядом с HTTP-декларациями.
Отдельного списка состава у транспорта нет.

```typescript
// examples/app-with-http/src/features/users/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  endpoints: [ListUsers, GetUser, CreateUser, GetUserTool, SearchUsersTool],
});
```

## Инструмент, которого нет в API

Агенту бывает нужно то, чего клиенту API не нужно: поиск по подстроке
вместо страничного списка. Такой инструмент объявляется анонимной формой
вместе со схемами.

```typescript
// examples/app-with-http/src/features/users/tools/search-users.tool.ts
export const SearchUsersTool = mcpTool('search_users', {
  description:
    'Найти пользователей по подстроке в адресе почты. Возвращает число ' +
    'найденных и их карточки.',
  annotations: { readOnlyHint: true },
  input: SearchUsersInput,
  output: SearchUsersOutput,
  pipeline: observability,
  handler: SearchUsersHandler,
});
```

Описание обязательно: агент выбирает инструмент по нему, и инструмент
без описания он выбрать не может. Инструмент без описания валит старт
приложения — вместе с остальными нарушениями, одним списком.

## Слой на инструменте

Пайплайна по умолчанию у транспорта нет: слой объявляет каждая
декларация. Заголовки запроса агента доходят до пайплайна обычным путём,
поэтому `authed` работает на инструменте так же, как на HTTP-декларации.

```typescript
// examples/app-with-http/src/features/users/tools/create-user.tool.ts
export const CreateUserTool = mcpTool.implement(CreateUserOperation, {
  annotations: { idempotentHint: false },
  pipeline: authed,
  handler: CreateUserHandler,
});
```

Требование «слой есть у каждого инструмента» записывается политикой
корня — той же, какой оно записано для HTTP.

```typescript
// examples/app-with-http/src/app.ts
everyEndpoint({ transport: McpTransport$('default') }).hasLayer(
  observability,
  'observability',
),
```

## Что получает агент

`tools/list` отдаёт определения, построенные на старте. `tools/call`
исполняет декларацию `dispatch.call`: инструмент проходит свой пайплайн,
свои слои и свои политики.

Успех уходит текстом JSON в `content` и, если форма выхода переводится в
объектную схему, ещё и в `structuredContent`. Отказ операции уходит тем же
результатом с `isError: true` и текстом, в котором названы код, сообщение
и детали. Ошибкой протокола отказ не становится: объявленный отказ — часть
контракта операции, и агент должен его прочитать и учесть.

Инструменты в документ OpenAPI не попадают: адреса по HTTP у них нет.
