# OpenAPI из деклараций

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-08-27).

Приложение уже знает о себе всё, что нужно внешнему потребителю: жадный
контейнер собрал полное дерево ручек на старте, каждая несёт bind-карту
«поле → место», объявленные отказы и формы io. Наружу это знание не
выходило: не-TS-потребителю оставалось читать код.

`@nestling/openapi` закрывает дыру. Второго описания API рядом с кодом не
появляется — документ **выводится** из тех же значений, которые обслуживают
запросы.

## Подключение: три строки в корне

```typescript
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';

const app = assemble({
  features: [UsersFeature, OpsFeature, QuotasFeature],
  select: cfg.features,
  modules: [
    appLogging,
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability,
    }),
  ],
  transports: [http({ port: 3000 })],
  policies: [
    everyEndpoint({ transport: HttpTransport$ }).hasLayer(observability),
  ],
});
```

`GET /openapi.json` отдаёт документ. Это **обычный параметризованный
модуль** — примитива «плагин» в ядре нет: `openapi(...)` возвращает то же,
что `logging({ service })`, и дискавери, политики и визуализация работают с
ним как с любым другим модулем.

### Почему `pipeline:` в опциях

Корень вправе требовать политикой слой на каждой HTTP-ручке. Satellite-модуль
про этот слой ничего не знает, поэтому получает его аргументом. Есть и
второй выход — `detached: '<причина>'`, — но он выводит ручку из-под **всех**
инвариантов, и это решение стоит принимать осознанно.

Раз корень назвал слой, он же отвечает и за его провайдера: в примере
`appLogging` попал в `modules:` именно поэтому, а не «на всякий случай».

### Почему `converters:` придётся назвать явно

Standard Schema интроспекции не даёт: узнать структуру схемы можно только
через код, знающий конкретный валидатор. Такой код — конвертер — приезжает
**данными**, отдельным пакетом со своей peer-зависимостью. Вшитого реестра
«вендор → конвертер» нет намеренно: он был бы implicit magic и optional
peer-deps на все валидаторы разом. Одна строка в корне даже в
стопроцентно-zod приложении — честная плата за explicit over implicit.

## Boot-time-гарантия

Документ строится провайдером жадного контейнера, то есть на **фазе 1
ASSEMBLE**. Отдельного кода под гарантию никто не писал — она следствие:

```
$ APP_FEATURES=all yarn start
Error: 1 endpoint(s) cannot be documented:

  - 'POST /api/imports' (module 'module:imports'): the 'input' schema is a
    'valibot' schema, and no converter for that vendor was passed. Either add
    one to 'converters' (for example zodConverter() from
    @nestling/openapi.zod), or declare the schema explicitly with
    jsonSchema(schema, { … }).
```

Сокет не открыт, `@OnInit` не выполнялся. Пока документация включена,
недокументируемых HTTP-ручек в приложении не существует. Ленивого построения
нет и не будет: оно уничтожило бы ровно эту гарантию.

Диагностируется **каждая** ручка, а не первая попавшаяся: чинить по одной за
прогон — не режим работы.

## Слот `doc:` — то, чего в схемах нет

JSON Schema описывает форму данных и молчит о самой операции. Всё остальное
объявляется одной секцией:

```typescript
export const CreateUser = makeContract({
  name: 'api.users.create',
  kind: 'request',
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
| `tags` | группировка; из имени модуля теги **не выводятся** |
| `deprecated` | пометка устаревания |
| `status` | статус успешного ответа; по умолчанию `OK`, без `output` — `NO_CONTENT` |
| `hidden` | причина, по которой ручка не попадает в документ |

Слот транспорт- и формат-нейтрален: полей, осмысленных только для OpenAPI,
в нём нет — тот же слот будет читать генерация AsyncAPI. Поэтому
`operationId` **выводится**, а не объявляется: имя контракта, если
декларация служит контракту, иначе детерминированный слаг
(`GET /api/users/:id` → `get_api_users_id`). Попытка объявить его вручную —
ошибка в точке создания декларации.

Ядро `doc:` не интерпретирует: ни один путь исполнения запроса от него не
зависит. Читают его генераторы описаний.

**В контракт-форме `doc` принадлежит контракту** наравне с
`input`/`output`/`errors`: документация операции — часть её интерфейса, а не
реализации, и две реализации одного контракта не могут описывать его
по-разному.

### Не документировать ручку можно только с причиной

```typescript
export const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: HealthOutput,
  detached: 'liveness-проба балансировщика: строка аудита на каждый удар — шум',
  doc: { hidden: 'служебная проба балансировщика, не часть публичного API' },
  handle: async () => new Ok({ status: 'up' }),
});
```

Формы `hidden: true` не существует ни в типах, ни в рантайме — прямая калька
с `detached`: тотальный opt-out обязан читаться в diff'е. Скрытая ручка
выпадает и из документа, и из проверки схем; список скрытого модуль печатает
на старте, рядом со списком detached-ручек. В сам документ он не попадает —
документ уходит наружу.

## Что во что превращается

**Адрес и параметры — из bind-карты.** `input` конвертируется в JSON Schema
**один раз**, дальше раскладывается:

| Источник | Куда | `required` |
|---|---|---|
| поле совпало с path-параметром | `parameters[in: path]` | всегда |
| поле помечено `query()` | `parameters[in: query]`, `style: form`, `explode: true` | из `required[]` схемы |
| остальные поля при `rest: 'query'` | `parameters[in: query]` | оттуда же |
| остальные поля при `rest: 'body'` | `requestBody` минус вынесенные | схема как есть |

`query({ multiple: true })` даёт схему-массив. Вынесенные поля вычитаются и
из `properties`, и из `required` тела.

**Media types — из формы io**, штатным `mediaTypeOf` (одно правило на
транспорт, клиента и документацию):

| Форма | Запрос | Ответ |
|---|---|---|
| значение | `application/json` | `application/json` |
| `stream(T)` | `application/x-ndjson` | `application/x-ndjson`, схема — **элемент** |
| `events(T)` | — | `text/event-stream`, схема элемента в `description` |
| `multipart({fields, files})` | `multipart/form-data`: поля плюс файлы (`format: binary`) | — |
| примитив `binary`/`text` | `application/octet-stream` / `text/plain` | то же |

`rawBody: true` на media type не влияет: сырые байты — свойство стартового
контекста, а не провода.

**`responses` покрывают весь контракт границы:**

- успех — код из `doc.status`, переведённый той же таблицей, что и в бою;
- каждый `errors[i]` — код своего `status`, тело `{ error, code, details? }`
  (то, что **реально пишет** транспорт); несколько отказов на одном коде →
  `oneOf`;
- `400` добавляется автоматически ручке со схемой входа: граница отвечает
  `VALIDATION_FAILED` независимо от `errors:`;
- `default` — `UnknownError`: множество ответов закрыто как `E ∪ UnknownError`.

## Диагностики, которых раньше не было нигде

Генератор — первый потребитель, которому нужна **структура** схемы. Отсюда
две проверки, которые change `input-bind` явно отложил до него:

```
  - 'GET /api/users/:id' (module 'module:users'): path parameter ':id' has no
    matching property in the converted 'input' schema. Add 'id' to the input
    schema, or rename the path segment.
```

и то же для `bind`-пометки на несуществующем поле. Плюс дубль `(метод, путь)`
— ошибка, называющая обе ручки и их модули.

## Экзотическая схема: `jsonSchema(schema, json)`

Если конвертера для вендора нет и не будет, JSON Schema объявляется рядом со
схемой:

```typescript
import { jsonSchema } from '@nestling/pipeline';

input: z.object({ payload: jsonSchema(ExoticSchema, { type: 'object' }) })
```

Аннотированная схема валидирует **ровно как исходная** (`~standard` тот же),
поэтому работает в любой схемной позиции — `input`, `output`, лист потоковой
формы, `fields` формы `multipart`, `details` определения отказа. Исходная
схема не мутируется, глобального реестра аннотаций нет. Диспетчер читает
аннотацию **раньше** конвертера, так что конвертер для этого листа
перестаёт быть нужен.

Тем же механизмом объявлены схемы самого ядра: `details` отказа
`VALIDATION_FAILED` написаны руками (Standard Schema — интерфейс, а не
библиотека), и ни один вендор-конвертер их не понимает.

### Схемы с преобразованием

`z.string().transform(Number)` описывает две формы: строку на проводе и
число у хендлера. Генератор передаёт конвертеру направление — `io: 'input'`
для тела запроса, `io: 'output'` для тела ответа, — и документ описывает
именно то, что едет. Если конвертер отказался переводить схему, диагностика
называет ручку и слот:

```
  - 'GET /report' (module 'module:reports'): its 'output' schema could not be
    converted to JSON Schema: Date cannot be represented in JSON Schema.
    Declare the schema explicitly with jsonSchema(schema, { … }), or replace
    the unrepresentable part of it.
```

## Документ без приложения: CI

`buildOpenApiDocument` — чистая функция. Ни контейнера, ни транспортов, ни
поднятого приложения ей не нужно:

```typescript
import { discoverEndpoints } from '@nestling/app';
import { buildOpenApiDocument } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';

const { endpoints } = discoverEndpoints([UsersModule, OpsModule]);

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

Документ нужен в двух режимах — отдаваться ручкой и лежать файлом в
артефактах сборки; общий у них только первый, поэтому функция и модуль это
две поверхности, а не одна.

## Документ как значение

Модуль кладёт готовый документ в граф под токеном `OpenApiDocument$`. Ручка —
способ его отдать, а не место, где он появляется:

```typescript
factoryProvider(Report$, (document) => summarize(document), [OpenApiDocument$])
```

Состав приложения тоже доступен значением — `Discovery$` из
`@nestling/app`. Это единственный способ satellite-модулю увидеть
**выбранную** топологию, не дублируя `select` в корне: с
`APP_FEATURES=users` документ не описывает ручки невыбранных фич. Значение
read-only — инжектируемая дискавери это поверхность интроспекции, а не точка
расширения.

## Чего в поставке нет

- **Swagger UI / ReDoc**: модуль отдаёт документ, статику отдаёт
  `@common/static-server` или reverse proxy.
- **OpenAPI 3.0**: конвертеры отдают JSON Schema 2020-12, а понижение
  диалекта — лоссовая операция, за которую фреймворк не берётся.
- **AsyncAPI** для `command`/`event` — тем же механизмом и тем же слотом
  `doc`, но отдельным change'ем.
- **`servers` из конфигурации транспорта**: за прокси значение всё равно
  неверное. Пока — опция, переносимая в документ как есть (вместе с
  `security`, `securitySchemes` и `externalDocs`).
- **Сверка `doc.status` с тем, что вернул хендлер**: успешный статус в V1 не
  выражен типом, и это зафиксировано открытым вопросом
  ([deferred.md](../decisions/deferred.md)), а не закрыто конвенцией.

## Смотри также

- [design/schemas.md](../design/schemas.md) — целевое состояние схемного слоя
- [design/endpoints.md](../design/endpoints.md) — bind-карта и формы io
- [guides/typed-client.md](./typed-client.md) — второй потребитель контракта
