# @nestling/openapi

Документ OpenAPI 3.1, собранный из тех же деклараций endpoint'ов, которые
обслуживают запросы. Второго описания API рядом с кодом не нужно.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/schemas.md`](../../docs/design/schemas.md) §2.1.
> Гайд: [`docs/guides/openapi.md`](../../docs/guides/openapi.md).

## Установка

```bash
npm install @nestling/openapi @nestling/openapi.zod
```

`@nestling/openapi.zod` нужен, если схемы написаны на zod. Для другого
валидатора подключите его конвертер (раздел «Конвертеры»).

## Минимальный пример

```typescript
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';

assemble({
  features: [UsersFeature],
  plugins: [
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability,        // если политика корня требует слой от каждого endpoint'а
    }),
  ],
  transports: [http({ port: 3000 })],
});
// GET /openapi.json
```

## Три способа получить документ

| Что | Когда использовать |
|---|---|
| `buildOpenApiDocument(endpoints, options)` | чистая функция; CI кладёт `openapi.json` в артефакты, не поднимая приложение |
| `openapi(options)` | модуль: строит документ на фазе ASSEMBLE и отдаёт его endpoint'ом `GET /openapi.json` |
| `OpenApiDocument$` | токен готового документа для провайдера, которому документ нужен значением |

Вход чистой функции — то же значение, что возвращает `discoverEndpoints`:

```typescript
const { endpoints } = discoverEndpoints(modulesOf(features));
writeFileSync('openapi.json', JSON.stringify(
  buildOpenApiDocument(endpoints, { info, converters: [zodConverter()] }),
));
```

## Откуда берётся каждая часть документа

| Часть | Источник |
|---|---|
| путь и метод, `parameter` или `requestBody` | bind-карта декларации (`:param` становится `{param}`) |
| media types | `mediaTypeOf` — то же правило, что у транспорта и клиента |
| `responses` | `output`, `errors:`, автоматический `400` и `default` (`UNKNOWN`) |
| HTTP-коды | `httpCodeOf` из `@nestling/transport.http` |
| `summary`, `tags`, `deprecated`, успешный статус | слот `doc:` декларации или операции |
| `operationId` | имя операции, иначе слаг из метода и пути; отдельно не объявляется |
| JSON Schema листьев | конвертер вендора или аннотация `jsonSchema(schema, json)` |

## Проверка на старте

Документ строит провайдер жадного контейнера, то есть фаза ASSEMBLE.
Схема, для вендора которой не передан конвертер, роняет сборку до
`@OnInit` и до открытия сокета. Ленивого построения нет.

Проверяется каждый endpoint, а не первый попавшийся; нарушения собираются
в одно сообщение. Кроме отсутствующего конвертера проверяются
path-параметр, которому нет свойства в схеме, и пометка `bind` на
несуществующем поле.

Скрыть HTTP-endpoint из документа можно только с причиной:
`doc: { hidden: '<причина>' }`. Список скрытых endpoint'ов модуль печатает
на старте (опция `announceHidden`); в документ он не попадает.

## Конвертеры

Конвертер переводит схему конкретного валидатора в JSON Schema. Список
конвертеров передаётся опцией `converters`; встроенного реестра по
вендорам нет, и даже в приложении целиком на zod конвертер указывается
явно. Конвертеры поставляются отдельными пакетами:
[`@nestling/openapi.zod`](../nestling.openapi.zod) и подобные. Свой
конвертер пишется против типа `SchemaDocConverter`, который пакет
реэкспортирует.

Валидатора среди зависимостей пакета нет; это проверяет тест границы
`boundary.spec.ts`.

## Справочник

### Опции `openapi()` и `buildOpenApiDocument()`

| Опция | Что делает |
|---|---|
| `info` | секция `info` документа; единственное обязательное поле |
| `converters` | конвертеры схем по вендорам |
| `servers` | секция `servers`; переносится как есть, из конфига транспорта не выводится |
| `security`, `securitySchemes`, `externalDocs` | переносятся в документ как есть |

Только у модуля `openapi()`:

| Опция | Что делает |
|---|---|
| `path` | путь endpoint'а с документом; по умолчанию `/openapi.json` |
| `pipeline` | пайплайн этого endpoint'а, чтобы он проходил политики корня |
| `detached` | причина вывода endpoint'а из-под политик |
| `announceHidden` | печатать ли на старте список скрытых endpoint'ов; по умолчанию печатает |

### Экспорты

`buildOpenApiDocument`, `hiddenEndpoints`, `openapi`, `OpenApiDocument$`;
типы `OpenApiOptions`, `OpenApiServeOptions`, `OpenApiDocument`,
`OpenApiInfo`, `OpenApiOperation`, `OpenApiParameter`,
`OpenApiRequestBody`, `OpenApiResponse`, `OpenApiPathItem`,
`OpenApiContent`, `DocumentedEndpoint`, `JsonValue`, `SchemaDocConverter`.

## Границы пакета

Пакет не поставляет Swagger UI, не выводит `servers` из конфигурации и не
генерирует AsyncAPI.
