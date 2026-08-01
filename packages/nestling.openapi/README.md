# @nestling/openapi

An **OpenAPI 3.1** document generated from the endpoint declarations that
already serve the requests. No decorators, no second description of the API
next to the code.

> 🚧 Active development, API may change. Design:
> [`docs/design/schemas.md`](../../docs/design/schemas.md) §2.1.
> Guide: [`docs/guides/openapi.md`](../../docs/guides/openapi.md).

```typescript
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';

assemble({
  features: [UsersFeature],
  modules: [
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability,        // корень требует слой от каждой ручки
    }),
  ],
  transports: [http({ port: 3000 })],
});
// GET /openapi.json
```

## Three surfaces

| Что | Зачем |
|---|---|
| `buildOpenApiDocument(endpoints, options)` | чистая функция: CI кладёт `openapi.json` в артефакты, не поднимая приложение |
| `openapi(options)` | модуль-издатель: строит документ на фазе ASSEMBLE и отдаёт ручкой |
| `OpenApiDocument$` | токен готового документа — для тех, кому он нужен значением |

Вход чистой функции — то же значение, что отдаёт `discoverEndpoints`:

```typescript
const { endpoints } = discoverEndpoints(modulesOf(features));
writeFileSync('openapi.json', JSON.stringify(
  buildOpenApiDocument(endpoints, { info, converters: [zodConverter()] }),
));
```

## Откуда берётся каждая часть документа

| Часть | Источник |
|---|---|
| путь и метод, `parameter` vs `requestBody` | bind-карта декларации (`:param` → `{param}`) |
| media types | `mediaTypeOf` — то же правило, что у транспорта и клиента |
| `responses` | `output`, `errors:`, автоматический `400` и `default` (`UNKNOWN`) |
| коды провода | `httpCodeOf` транспорта — не копия таблицы |
| `summary`, `tags`, `deprecated`, успешный статус | слот `doc:` декларации или контракта |
| `operationId` | имя контракта, иначе слаг от метода и пути — **выводится, не объявляется** |
| JSON Schema листьев | вендор-конвертер либо аннотация `jsonSchema(schema, json)` |

## Boot-time-гарантия

Документ строится провайдером жадного контейнера, то есть на фазе 1
ASSEMBLE. Отдельного кода под гарантию нет — она следствие: схема, для
вендора которой не передан конвертер, роняет сборку **до `@OnInit` и до
открытия сокета**. Ленивого построения не существует: оно уничтожило бы
ровно эту гарантию.

Диагностируется каждая ручка, а не первая попавшаяся; нарушения уезжают
одним сообщением. Сюда же попали две проверки, которых раньше не было
нигде: path-параметр, которому нет свойства в схеме, и `bind`-пометка на
несуществующем поле — до вендор-конвертера структуру схемы узнать было
нечем.

Единственный способ не документировать HTTP-ручку — `doc: { hidden:
'<причина>' }`. Причина обязательна по той же логике, что у `detached`:
тотальный opt-out должен читаться в diff'е. Список скрытых ручек модуль
печатает на старте; в документ он не попадает.

## Зависимости

Валидатора среди них нет: конвертер — **данные вызывающего**, а не
зависимость пакета. Это проверяется тестом границы (`boundary.spec.ts`), а
не обещанием в README: он смотрит и на граф импортов собранного `dist/`, и
на манифест.

Конвертеры поставляются отдельными пакетами со своей peer-зависимостью —
[`@nestling/openapi.zod`](../nestling.openapi.zod) и подобные.
