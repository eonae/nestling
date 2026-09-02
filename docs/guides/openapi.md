# OpenAPI из деклараций

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-09-02).

`@nestling/openapi` строит документ OpenAPI 3.1 из тех же деклараций
endpoint'ов, которые обслуживают запросы: из bind-карты «поле → место»,
объявленных отказов и форм io. Второго описания API рядом с кодом не
появляется, а потребителю без TypeScript не приходится читать исходники.

## Подключение

```typescript
// packages/examples.app-with-http/src/main.ts
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';

const app = assemble({
  features: [UsersFeature, OpsFeature, QuotasFeature],
  select: cfg.features,
  plugins: [
    appLogging,
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability,
    }),
  ],
  transports: [http({ port: 3000 })],
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(observability, 'observability'),
  ],
});
```

После запуска `GET /openapi.json` отдаёт документ. `openapi(...)` — обычный
параметризованный модуль, такой же, как `logging({ service })`: discovery,
политики и визуализация работают с ним как с любым другим модулем.
Отдельного примитива «плагин» в ядре нет.

Опции модуля:

| Опция | Что делает |
|---|---|
| `info` | секция `info` документа; единственное обязательное поле |
| `converters` | конвертеры схем в JSON Schema, по одному на вендора валидатора |
| `pipeline` | пайплайн endpoint'а `GET /openapi.json` |
| `path` | путь endpoint'а; по умолчанию `/openapi.json` |
| `detached` | причина, по которой endpoint документа выведен из-под политик |
| `announceHidden` | печатать ли на старте список скрытых endpoint'ов; по умолчанию `true` |
| `servers`, `security`, `securitySchemes`, `externalDocs` | переносятся в документ как есть |

### Опция `pipeline`

Если корень требует политикой слой на каждом HTTP-endpoint'е (как
`observability` выше), endpoint самого документа тоже обязан его иметь.
Модуль про этот слой ничего не знает, поэтому получает его опцией
`pipeline`. Второй способ — `detached: '<причина>'`, но он выводит endpoint
из-под всех политик сразу.

Провайдера для юнитов слоя корень тоже регистрирует сам: в примере
`appLogging` стоит в `plugins:` именно ради слоя `observability`.

### Опция `converters`

Standard Schema не даёт заглянуть внутрь схемы: узнать её структуру может
только код, который знает конкретный валидатор. Такой код — конвертер — вы
передаёте списком. Конвертеры поставляются отдельными пакетами со своей
peer-зависимостью: `@nestling/openapi.zod` для zod. Встроенного реестра
«вендор → конвертер» в пакете нет, поэтому конвертер называется явно даже
в приложении, где все схемы написаны на zod.

## Проверка на старте

Документ строится провайдером на фазе `1 ASSEMBLE`, вместе с остальным
графом. Если какую-то схему перевести в JSON Schema нечем, сборка падает
до открытия сокета и до первого `@OnInit`:

```
$ APP_FEATURES=all yarn start
Error: 1 endpoint(s) cannot be documented:

  - 'POST /api/imports' (module 'module:imports'): the 'input' schema is a
    'valibot' schema, and no converter for that vendor was passed. Either add
    one to 'converters' (for example zodConverter() from
    @nestling/openapi.zod), or declare the schema explicitly with
    jsonSchema(schema, { … }).
```

Пока модуль подключён, в приложении нет HTTP-endpoint'а, который нельзя
задокументировать. Документ не строится лениво, при первом запросе:
тогда ошибка проявилась бы только в рантайме.

Проверяются все endpoint'ы за один прогон, и все нарушения собираются в
одно сообщение.

## Слот `doc:`

JSON Schema описывает форму данных, но ничего не говорит о самой операции.
Название, описание, теги и статус успешного ответа объявляются в слоте
`doc:` декларации или операции:

```typescript
// packages/examples.app-with-http/src/api.operations.ts
export const CreateUser = makeRequest({
  name: 'api.users.create',
  http: { method: 'POST', path: '/api/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, QuotaExceeded],
  doc: {
    summary: 'Создать пользователя',
    description: 'Занимает квоту у соседней фичи…',
    tags: ['users'],
    status: 'CREATED',
  },
});
```

| Поле | Что делает |
|---|---|
| `summary`, `description` | название и развёрнутое описание операции |
| `tags` | группировка операций; из имени модуля теги не выводятся |
| `deprecated` | пометка устаревания |
| `status` | статус успешного ответа; по умолчанию `OK`, без `output` — `NO_CONTENT` |
| `hidden` | причина, по которой endpoint не попадает в документ |

Слот не привязан ни к транспорту, ни к формату документа: тот же слот
будет читать генератор AsyncAPI, поэтому полей, осмысленных только для
OpenAPI, в нём нет. `operationId` не объявляется, а выводится: это имя
операции, если декларация обслуживает операция, иначе слаг из метода и
пути (`GET /api/users/:id` даёт `get_api_users_id`). Попытка задать
`operationId` вручную — ошибка в точке создания декларации.

Ядро содержимое `doc:` не читает: ни один путь исполнения запроса от него
не зависит. Слот читают только генераторы документации.

В форме с операцией `doc` принадлежит операции наравне с `input`, `output`
и `errors`. Документация операции — часть её интерфейса, и две реализации
одной операции не могут описывать её по-разному.

### Скрытый endpoint

```typescript
// packages/examples.app-with-http/src/modules/ops/health.endpoint.ts
export const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: HealthOutput,
  detached: 'liveness-проба балансировщика: строка аудита на каждый удар — шум',
  doc: { hidden: 'служебная проба балансировщика, не часть публичного API' },
  handle: async () => new Ok({ status: 'up' }),
});
```

Единственный способ не документировать HTTP-endpoint — `doc: { hidden:
'<причина>' }`. Формы `hidden: true` нет ни в типах, ни в рантайме: как и
у `detached`, причина обязательна, чтобы список исключений читался в
diff'е и на ревью. Скрытый endpoint выпадает и из документа, и из
проверки схем. Список скрытых endpoint'ов модуль печатает на старте рядом
со списком detached-endpoint'ов; в сам документ этот список не попадает.

## Как декларация превращается в операцию

### Адрес и параметры

Адрес и параметры берутся из bind-карты. `input` конвертируется в JSON
Schema один раз, затем раскладывается по частям операции:

| Источник | Куда | `required` |
|---|---|---|
| поле совпало с path-параметром | `parameters[in: path]` | всегда |
| поле помечено `query()` | `parameters[in: query]`, `style: form`, `explode: true` | из `required[]` схемы |
| остальные поля при `rest: 'query'` | `parameters[in: query]` | из `required[]` схемы |
| остальные поля при `rest: 'body'` | `requestBody` без вынесенных полей | схема как есть |

`query({ multiple: true })` даёт схему-массив. Вынесенные в параметры поля
удаляются и из `properties`, и из `required` тела.

### Media types

Media type определяется формой io функцией `mediaTypeOf`. Это одно правило
на транспорт, клиента и документацию:

| Форма | Запрос | Ответ |
|---|---|---|
| значение | `application/json` | `application/json` |
| `stream(T)` | `application/x-ndjson` | `application/x-ndjson`, схема описывает элемент |
| `events(T)` | — | `text/event-stream`, схема элемента в `description` |
| `multipart({fields, files})` | `multipart/form-data`: поля плюс файлы (`format: binary`) | — |
| примитив `binary` / `text` | `application/octet-stream` / `text/plain` | то же |

`rawBody: true` на media type не влияет: сырые байты — свойство стартового
контекста, а не формата запроса.

### Ответы

`responses` описывают все ответы, которые может дать граница пайплайна:

- успех — код из `doc.status`, переведённый той же таблицей, что использует
  транспорт;
- каждый элемент `errors` — код своего `status` и тело `{ error, code,
  details? }`, то есть ровно то, что пишет транспорт. Несколько отказов с
  одним кодом объединяются через `oneOf`;
- `400` добавляется автоматически каждому endpoint'у со схемой входа:
  граница отвечает `VALIDATION_FAILED` независимо от `errors`;
- `default` — `UnknownError`: любой незадекларированный отказ.

## Диагностики структуры схем

Генератор — первый потребитель, которому нужна структура схемы, поэтому
две проверки живут в нём:

```
  - 'GET /api/users/:id' (module 'module:users'): path parameter ':id' has no
    matching property in the converted 'input' schema. Add 'id' to the input
    schema, or rename the path segment.
```

Та же проверка есть для пометки `bind` на несуществующем поле. Два
endpoint'а с одинаковой парой «метод, путь» — ошибка, которая называет оба
endpoint'а и их модули.

## Схема без конвертера: `jsonSchema(schema, json)`

Если конвертера для вендора нет, объявите JSON Schema рядом со схемой:

```typescript
import { jsonSchema } from '@nestling/pipeline';

input: z.object({ payload: jsonSchema(ExoticSchema, { type: 'object' }) })
```

Аннотированная схема валидирует ровно как исходная: у неё тот же
`~standard`. Поэтому она годится в любой схемной позиции: `input`,
`output`, лист потоковой формы, `fields` формы `multipart`, `details`
определения отказа. Исходная схема не изменяется, глобального реестра
аннотаций нет. Генератор читает аннотацию раньше, чем обращается к
конвертеру, поэтому конвертер для такого листа не нужен.

Тем же механизмом объявлены схемы самого ядра: `details` отказа
`VALIDATION_FAILED` написаны руками поверх Standard Schema, и вендорские
конвертеры их не понимают.

### Схемы с преобразованием

`z.string().transform(Number)` описывает две формы: строку в запросе и
число у хендлера. Генератор передаёт конвертеру направление: `io: 'input'`
для тела запроса, `io: 'output'` для тела ответа. Документ описывает
именно ту форму, которая передаётся по сети. Если конвертер отказался
переводить схему, диагностика называет endpoint и слот:

```
  - 'GET /report' (module 'module:reports'): its 'output' schema could not be
    converted to JSON Schema: Date cannot be represented in JSON Schema.
    Declare the schema explicitly with jsonSchema(schema, { … }), or replace
    the unrepresentable part of it.
```

## Документ без приложения: CI

`buildOpenApiDocument` — чистая функция. Ей не нужны ни контейнер, ни
транспорты, ни запущенное приложение:

```typescript
import { discoverEndpoints } from '@nestling/app';
import { buildOpenApiDocument } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';

const { endpoints } = discoverEndpoints([UsersFeature, OpsFeature]);

writeFileSync(
  'openapi.json',
  JSON.stringify(
    buildOpenApiDocument(endpoints, {
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
    }),
    null,
    2,
  ),
);
```

Так документ попадает в артефакты сборки. Модуль `openapi()` использует ту
же функцию, чтобы отдать документ endpoint'ом.

## Документ как значение

Модуль регистрирует готовый документ в графе под токеном
`OpenApiDocument$`. Endpoint `GET /openapi.json` — лишь один из способов
его отдать; инжектируйте токен, если документ нужен в другом формате или
в тесте:

```typescript
factoryProvider(Report$, (document) => summarize(document), [OpenApiDocument$])
```

Состав приложения тоже доступен как значение: токен `Discovery$` из
`@nestling/app`. Через него модуль видит выбранную топологию без
дублирования `select` в корне: при `APP_FEATURES=users` документ не
описывает endpoint'ы невыбранных фич. Значение только для чтения: через
него нельзя изменить состав приложения.

## Чего в пакете нет

- Swagger UI и ReDoc. Модуль отдаёт документ; статику отдаёт
  `@common/static-server` или reverse proxy.
- OpenAPI 3.0. Конвертеры отдают JSON Schema 2020-12; понижение до 3.0
  теряет часть информации, и пакет его не выполняет.
- AsyncAPI для `command` и `event`. Будет построен тем же механизмом и
  из того же слота `doc`.
- `servers` из конфигурации транспорта. За reverse proxy значение всё
  равно было бы неверным; передавайте `servers` опцией.
- Сверка `doc.status` с тем, что вернул хендлер. Успешный статус в V1
  не выражен типом; вопрос открыт в [deferred.md](../decisions/deferred.md).

## Смотри также

- [design/schemas.md](../design/schemas.md) — целевое состояние схемного слоя
- [design/endpoints.md](../design/endpoints.md) — bind-карта и формы io
- [guides/typed-client.md](./typed-client.md) — второй потребитель операции
