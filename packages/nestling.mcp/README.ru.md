# @nestlingjs/mcp

MCP как входящий транспорт приложения. Инструмент агента — endpoint этого
транспорта: имя, схемы, отказы и описание берутся с декларации, второго
описания для агента писать не нужно.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/transports.md`](../../docs/design/transports.md) §8.
> Рецепт: [отдать операции агенту по MCP](../../docs/recipes/mcp.md).

## Установка

```bash
npm install @nestlingjs/mcp @nestlingjs/schema.zod
```

`@nestlingjs/schema.zod` нужен, если схемы написаны на zod. Для другого
валидатора подключается его конвертер.

## Минимальный пример

```typescript
import { mcp, mcpTool } from '@nestlingjs/mcp';
import { zodConverter } from '@nestlingjs/schema.zod';
import { http, httpServer } from '@nestlingjs/transport.http';

export const GetUserTool = mcpTool.implement(GetUser, {
  annotations: { readOnlyHint: true },
  handler: GetUserHandler,
});

const api = httpServer();

makeApp({
  features: [UsersFeature], // GetUserTool лежит в `endpoints:` фичи
  transports: [
    api,
    http({ server: api }),
    mcp({
      server: api,
      info: { name: 'users-service', version: '1.0.0' },
      converters: [zodConverter()],
    }),
  ],
});
// POST /mcp на том же сокете, что и HTTP-API
```

## Экспорты

- **Транспорт** ([design](../../docs/design/transports.md)) — `mcp`,
  `MCP_CAPABILITIES`, `McpRuntimeOptions`, `McpTransport`,
  `McpTransport$`, `MCP_TRANSPORT_NAME`, `McpTransportOptions`,
  `DEFAULT_PATH`, `DEFAULT_SESSION_IDLE_MS`, `DEFAULT_SESSION_LIMIT`.
- **Декларация инструмента**
  ([design](../../docs/design/endpoints.md)) — `AnyRequestOperation`,
  `deriveToolName`, `McpBinding`, `mcpBindingOf`, `McpImplementDictionary`,
  `mcpTool`, `McpToolDictionary`.

  `mcpTool` — значение, а не функция. Вызов объявляет инструмент вместе
  со схемами, а `mcpTool.implement(Operation, { … })` обслуживает
  объявленную операцию: схемы, отказы и секция `doc` берутся с неё.
- **Определения для агента** ([design](../../docs/design/schemas.md)) —
  `BoundTool`, `buildToolDefinitions`, `BuildOptions`,
  `McpCallToolResult`, `McpContent`, `McpObjectSchema`, `McpServerInfo`,
  `McpToolAnnotations`, `McpToolDefinition`, `McpViolation`.
- **Протокол** — `LATEST_PROTOCOL_VERSION`, `McpSessionLimitReached`,
  `McpSessionNotFound`, `ProtocolVersion`, `SUPPORTED_PROTOCOL_VERSIONS`.

Реэкспорт [`@nestlingjs/app`](../nestling.app/): `SchemaDocConverter` —
интерфейс конвертера схем.

## Границы пакета

Пакет обслуживает только `tools`: ресурсов и промптов протокола он не
отдаёт. Сообщения, которые сервер инициирует сам, тоже вне объёма —
выборка, нотификации об изменении списка инструментов и логирование по
протоколу. Поэтому `GET` по пути транспорта не обслуживается: обработчик
его не берёт, и клиент получает `404` вместо `405`, которого предпочла бы
спецификация. Клиент из `@modelcontextprotocol/sdk` сообщает об этом
своему `onerror` и продолжает работать, потому что поток событий
необязателен.

Аутентификацию пакет не делает. Заголовки запроса доходят до пайплайна
декларации обычным путём, и кто вызывает — задача слоя приложения.

Пайплайна по умолчанию у транспорта нет: слой объявляет каждая
декларация, а требование «слой есть у каждого инструмента» записывается
политикой корня. Так же это работает у HTTP, и второго места, где
назначается слой, не заводится.

Собственного процесса со stdio у пакета нет: транспорт живёт в
приложении, которое обслуживает те же операции. Своего сокета он тоже не
заводит — `mcp({ server })` принимает объявление HTTP-сервера.

Протокол реализован в пакете, `@modelcontextprotocol/sdk` стоит в
`devDependencies` и работает доказательством: сверкой типов и
интеграционным прогоном настоящим клиентом. Зависимости рантайма от
валидатора и от HTTP-фреймворка у пакета нет.
