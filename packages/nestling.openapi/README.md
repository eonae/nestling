# @nestling/openapi

Документ OpenAPI 3.1, собранный из тех же деклараций endpoint'ов, которые
обслуживают запросы. Второго описания API рядом с кодом не нужно.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/schemas.md`](../../docs/design/schemas.md) §2.1.
> Гайд: [глава 12. Отдать фронтенду документацию и клиент](../../docs/guide/12-openapi-and-client.md).

## Установка

```bash
npm install @nestling/openapi @nestling/openapi.zod
```

`@nestling/openapi.zod` нужен, если схемы написаны на zod. Для другого
валидатора подключается его конвертер.

## Минимальный пример

```typescript
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';

makeApp({
  features: [UsersFeature],
  plugins: [
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability, // если политика корня требует слой
    }),
  ],
  transports: [http()],
});
// GET /openapi.json
```

## Экспорты

| Имя | Что делает |
|---|---|
| `openapi` | плагин: строит документ на фазе ASSEMBLE и отдаёт его endpoint'ом |
| `buildOpenApiDocument` | чистая функция: документ из `app.discover(args).endpoints` |
| `OpenApiDocument$` | DI-токен готового документа |
| `hiddenEndpoints` | endpoint'ы, скрытые полем `doc.hidden` |
| `OpenApiOptions` | `info`, `converters`, `servers`, `security`, `externalDocs` |
| `OpenApiServeOptions` | опции плагина: `path`, `pipeline`, `detached`, `announceHidden` |
| `OpenApiDocument` | документ целиком |
| `OpenApiInfo` | секция `info` |
| `OpenApiPathItem` | один путь документа |
| `OpenApiOperation` | одна операция пути |
| `OpenApiParameter` | параметр пути или query |
| `OpenApiRequestBody` | тело запроса |
| `OpenApiResponse` | один ответ операции |
| `OpenApiContent` | карта «media type — схема» |
| `DocumentedEndpoint` | вход генератора: декларация endpoint'а с секцией `doc:` |
| `JsonValue` | значение JSON в документе |
| Реэкспорт [`@nestling/app`](../nestling.app/) | `SchemaDocConverter` — интерфейс конвертера схем |

## Границы пакета

Пакет не поставляет Swagger UI, не выводит `servers` из конфигурации и не
генерирует AsyncAPI.
