# @nestlingjs/openapi

Документ OpenAPI 3.1, собранный из тех же деклараций endpoint'ов, которые
обслуживают запросы. Второго описания API рядом с кодом не нужно.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/schemas.md`](../../docs/design/schemas.md) §2.1.
> Гайд: [глава 13. Отдать фронтенду документацию и клиент](../../docs/guide/13-openapi-and-client.md).

## Установка

```bash
npm install @nestlingjs/openapi
```

Конвертер схем вендора, на котором написаны схемы фреймворка, приходит
зависимостью пакета. Приложению на другом валидаторе нужен его конвертер —
он передаётся списком `converters`.

## Минимальный пример

```typescript
import { openapi } from '@nestlingjs/openapi';

export const appOpenapi = openapi({
  info: { title: 'Users API', version: '1.0.0' },
  pipeline: observability, // если политика корня требует слой
});

makeApp({
  features: [UsersFeature],
  plugins: [appOpenapi],
  transports: [http()],
});
// GET /openapi.json

// Тот же документ для артефактов сборки, без поднятия приложения:
appOpenapi.document(app.discover(args));
```

## Экспорты

| Имя | Что делает |
|---|---|
| `openapi` | плагин: строит документ на фазе BUILD, отдаёт его endpoint'ом, а методом `document(discovery)` — значением |
| `OpenApiDocument$` | DI-токен готового документа |
| `OpenApiPlugin` | значение плагина: обычная единица состава плюс метод `document` |
| `OpenApiOptions` | `info`, необязательные `converters`, `servers`, `security`, `externalDocs` |
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
| Реэкспорт [`@nestlingjs/app`](../nestling.app/) | `SchemaDocConverter` — интерфейс конвертера схем |

Ответы-отказы описываются тем, что реально пишет транспорт: документом
RFC 9457 под медиатипом `application/problem+json`
([design](../../docs/design/errors.md)). Член `type` описан константой
`urn:error:<код отказа>`, `title` и `status` — константами по категории;
два отказа на одном коде ответа сводятся в `oneOf` и различимы по `type`.
Медиатип и построение `type` генератор берёт из экспортов
`@nestlingjs/transport.http`, поэтому документ и ответ не расходятся.

## Границы пакета

Пакет не поставляет Swagger UI, не выводит `servers` из конфигурации и не
генерирует AsyncAPI. Валидатора его публичные типы не называют: схема
приходит от приложения, а перевод в JSON Schema — конвертером.
