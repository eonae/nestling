## Context

Сейчас единственный способ вернуть заголовок ответа — второй параметр
`Ok`. Значение доходит до транспорта через `SuccessResponseContext.headers`
(`packages/nestling.app/src/pipeline/core/types/context.ts`), а
`sendResponse` в `adapter.ts` пишет его в ответ. Тот же путь читает
NATS-транспорт. Поле объявлено не зависящим от транспорта, но `Location` и
`Set-Cookie` осмысленны только в HTTP.

Три ограничения этого пути:

- редирект требует статуса 3xx, а `SuccessStatus` закрыт четырьмя
  статусами успеха;
- `Set-Cookie` повторяется в ответе, а `Record<string, string>` хранит
  одно значение на имя;
- хендлер, которому нужен заголовок запроса, читать его неоткуда: `meta`
  собирается из пайплайна, а пайплайн HTTP-запроса не видит.

Юниты пайплайна в том же положении. `StartContext<RB, O>` в
`packages/nestling.transport.http/src/helpers.ts` добавляет в стартовый
контекст только `rawBody` и `lastEventId`. Юнита, читающего заголовок,
написать нельзя, а если бы можно было — ничто не мешало бы поставить его в
`implement`.

Целевое состояние уже описано: [endpoints.md
§3](../../../docs/design/endpoints.md), [transports.md
§1.2](../../../docs/design/transports.md), [errors.md
§5](../../../docs/design/errors.md), [pipeline.md
§5](../../../docs/design/pipeline.md). Логика — [ideas.md
[2026-09-06]](../../../docs/decisions/ideas.md) «HTTP-хендлер явной
формой».

## Goals / Non-Goals

**Goals:**

- HTTP-специфика хендлера видна в его сигнатуре и проверяется компилятором.
- Редирект и cookie выражаются значением, а не набором заголовков.
- `Ok` описывает результат обработки и ничего не знает о HTTP.
- Юнит, знающий транспорт, не проходит в реализацию операции на шине.
- Ядро остаётся расширяемым: следующий транспорт добавляет свою форму
  ответа без правок `@nestling/app`.

**Non-Goals:**

- Разбор входящих cookie, подписанные cookie.
- Пометка `header()` в bind-карте.
- Разбор `X-Forwarded-For` в `withClientIp()`.
- Стартовый контекст и юниты CLI-транспорта.
- Типизация ответных заголовков схемой `output`.

## Decisions

### 1. Конверт транспортного ответа как расширение ядра

`HttpResponse` живёт в `@nestling/transport.http`, а разбирает результат
хендлера пайплайн в `@nestling/app`. Ядро не может знать HTTP-тип, поэтому
`@nestling/operations` объявляет протокол:

```typescript
const TRANSPORT_RESPONSE = Symbol.for('nestling:transport-response');

export interface TransportResponse<TValue = unknown> {
  readonly [TRANSPORT_RESPONSE]: true;
  /** Имя транспорта, который понимает `meta` */
  readonly transport: string;
  /** Метаданные протокола; ядро их не читает */
  readonly meta: unknown;
  /** Ответ без метаданных: `Ok` или значение */
  readonly result: OutputSync<TValue, AnyFail>;
}
```

`normalizeResponse` распознаёт конверт по символу, разбирает `result` тем
же кодом, что и раньше, и кладёт `{ name, meta }` в
`SuccessResponseContext.transport`. Транспорт читает слот, только если
`name` совпадает с его именем; иначе отвечает `internal_error` с текстом,
называющим endpoint, ожидаемый и полученный транспорт.

Поле `headers` уходит из обоих контекстов ответа: у ошибки его никто не
заполнял, у успеха его заменяют метаданные протокола.

_Альтернативы._ Оставить `Ok.headers` и добавить рядом `status` и
`cookies` — это тот же HTTP под именем «не зависит от транспорта», и
запись [2026-09-03] отменена именно поэтому. Импортировать `HttpResponse`
в `@nestling/app` — зависимость ядра от транспорта, обратная требуемой.
Слот `meta: unknown` без имени транспорта — CLI молча получил бы
HTTP-метаданные и отбросил их.

### 2. `http` в стартовом контексте — признак анонимной формы

Транспорт кладёт в стартовый контекст поле `http: HttpRequest`:

```typescript
export interface HttpRequest {
  readonly method: string;
  /** Путь с query-строкой, как прислан клиентом */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Адрес сокета; у прокси это адрес прокси */
  readonly ip?: string;
}

export type HttpStartContext<RB = undefined, O = unknown> =
  { http: HttpRequest } & StartContext<RB, O>;
```

Объект собирается из уже прочитанных значений: `headers` — та же ссылка,
что уходит в `raw.attributes`, `method` и `url` — поля `IncomingMessage`.
На запрос добавляется один литерал.

Анонимный `httpEndpoint` типизирует `meta` хендлера как `P & { http:
HttpRequest }` независимо от слота `pipeline`: декларация без пайплайна
тоже даёт хендлеру `meta.http`. Форма с `operation:` этого пересечения не
добавляет, поэтому класс, объявивший `meta: HttpHandlerMeta`, туда не
проходит по типам. Правило читается одной фразой: HTTP-метаданные есть
там, где адрес объявлен транспортом, и нет там, где адрес принадлежит
операции.

Юниты в форме с `operation:` пользуются `HttpStartContext` наравне с
анонимной формой: слот `pipeline` там уже свой, а хендлер остаётся без
`http` благодаря пересечению, которого нет.

_Альтернативы._ Generic параметр метаданных у `httpEndpoint` отвергнут
записью в ideas.md: он воскрешает `@Req()` из Nest. Отдельный конструктор
`httpEndpointWithRequest` — вторая декларация ради одного поля.

### 3. Слоты `implement` и операция-формы отвергают HTTP-пайплайн

`Pipeline<TReq, …>` ковариантен по `TReq` через фантомное поле, поэтому
`Pipeline<HttpStartContext, …>` присваивается слоту `Pipeline<EmptyInput,
…>` без ошибки. В `httpEndpoint` эту дыру закрывает условный тип
`ValidateStart<PR, Start>`. `implement` получает тот же приём: параметр
`PR` и `ValidateStart<PR, EmptyInput>` в слоте `pipeline`. Литерал ошибки
повторяет форму соседей — `__error`, `missing`, `hint`.

### 4. `HttpResponse` — значение с двумя конструкторами

```typescript
export class HttpResponse<TValue = unknown> implements TransportResponse<TValue> {
  static of<T>(ok: Ok<T> | T, options?: HttpResponseOptions): HttpResponse<T>;
  static redirect(location: string, options?: RedirectOptions): HttpResponse<never>;
}

export interface HttpResponseOptions {
  headers?: Record<string, string>;
  cookies?: readonly Cookie[];
}

export interface RedirectOptions extends HttpResponseOptions {
  status?: RedirectStatus;   // 301 | 302 | 303 | 307 | 308
}
```

`Cookie` — значение с полями `name`, `value`, `maxAge`, `expires`, `path`,
`domain`, `secure`, `httpOnly`, `sameSite`. Транспорт сериализует каждый
элемент в отдельный заголовок `Set-Cookie`; список решает задачу, которую
`Record<string, string>` решить не мог.

Результат хендлера описывают типы транспорта:

```typescript
export type HttpOutputSync<T, E> = OutputSync<T, E> | HttpResponse<T>;
export type HttpOutput<T, E = never> = Promise<HttpOutputSync<T, E>>;
```

### 5. Редирект объявляется декларацией, а не только вызовом

OpenAPI строится из декларации, поэтому редирект должен быть в ней виден.
`HttpEndpointDictionary` получает поле `redirect?: RedirectStatus`.

- Документ показывает объявленный статус и заголовок `Location` в ответе.
- Ответ уходит со статусом из вызова `HttpResponse.redirect`; без него —
  с объявленным; без обоих — `302`.
- Хендлер вернул редирект, а декларация поля не объявила — ответ
  `internal_error`, текст называет endpoint и поле `redirect`.

_Альтернативы._ Выводить редирект из типа результата хендлера —
недоступно: OpenAPI читает значение декларации, а не типы. Разрешить
редирект без объявления — документ разошёлся бы с поведением, и клиент
узнавал бы о 3xx на проде.

### 6. `Handler<C>` и `HttpHandler<C>` выводятся из операции

```typescript
export interface HandlerMeta {
  readonly signal: AbortSignal;
  readonly [field: string]: unknown;
}

export interface Handler<C extends AnyOperation> {
  handle(
    input: InferInput<InputFormOf<C>>,
    meta: HandlerMeta,
  ): Output<InferOutput<OutputFormOf<C>>, OperationFailsOf<C>>;
}
```

`HttpHandlerMeta` расширяет `HandlerMeta` полем `http: HttpRequest`;
`HttpHandler<C>` повторяет `Handler<C>` с этим `meta` и результатом
`HttpOutput`. `implements` даёт автодополнение и раннюю ошибку; сверка со
схемами остаётся в слоте `handler:`, потому что у анонимного
`httpEndpoint` операции нет.

`Handler<C>` живёт в `@nestling/app`: интерфейсу нужны и `Operation` из
`@nestling/operations`, и типы пайплайна. Имя совпадает с декоратором
`@Handler` из `@nestling/container`, а импортировать одно имя из двух
пакетов нельзя. Поэтому `@nestling/app` экспортирует то же имя как
значение (`export const Handler = HandlerDecorator`) рядом с интерфейсом:
константа и интерфейс объединяются, и один импорт даёт обе формы.
`@nestling/container` продолжает экспортировать декоратор для кода без
операций.

_Альтернативы._ Псевдоним на месте импорта (`import type { Handler as
OperationHandler }`) — канонический пример из `design/endpoints.md`
перестал бы компилироваться дословно. Другое имя интерфейса
(`IHandler`, `OperationHandler`) — против правила `$` из
[conventions.md](../../../docs/conventions.md) и против уже написанного
дизайна.

### 7. Юниты транспорта — обычные функции

Три юнита живут в новом модуле `packages/nestling.transport.http/src/units.ts`:

| Юнит | Что делает |
|---|---|
| `withHeader(name)` | кладёт значение заголовка в контекст под тем же именем; тип поля `string \| undefined` |
| `withClientIp()` | кладёт адрес сокета в поле `clientIp` |
| `httpAccessLog(logger)` | пишет строку доступа в фазе `.finally`: метод, путь, статус, длительность, `bytesIn`, `bytesOut` |

`withHeader` не переименовывает заголовок: имя поля равно имени заголовка,
и правило читается без исключений. Транспорт юниты не приставляет: слой
всегда виден в декларации.

`httpAccessLog` принимает логгер аргументом, как уже существующий
`withRequestLogging(logger)`. Так юнит остаётся функцией, и `TNeeds`
пайплайна не растёт — это же обещает таблица форм в
[pipeline.md §5](../../../docs/design/pipeline.md). Сигнатуру в
`transports.md §1.2` change правит с `httpAccessLog()` на
`httpAccessLog(logger)`.

### 8. Стартовый контекст в тестах

`testApp.call` собирает контекст сам и стартовых полей не заполняет.
`TestCallOptions` получает поле `input?: AnyInput` — стартовый контекст
запроса. Поле общее для всех транспортов: `@nestling/testing` не зависит
от `@nestling/transport.http` и HTTP-тип назвать не может.

```typescript
await app.call('POST /login', body, {
  input: { http: { method: 'POST', url: '/login', headers: {} } },
});
```

### 9. Потоковые ответы

`HttpResponse.of(stream, { headers })` допустим при потоковой форме
`output`. Транспорт пишет заголовки до первого кадра: ветка `streaming` в
`sendResponse` уже ставит их перед `writeSse`/`writeNdjson`. Редирект при
потоковой форме — ошибка создания декларации: `redirect` и
`output: stream(...)` вместе не объявляются.

## Risks / Trade-offs

- **Литерал `http` на каждый HTTP-запрос удорожает горячий путь.** →
  Объект собирается из готовых ссылок без копирования заголовков.
  `yarn bench:http` под Node 24 до и после, результат в записи change'а;
  порог — не хуже 2% на `GET` и `POST`.
- **Конверт ответа добавляет ветку в `normalizeResponse`.** → Ветка
  первая по частоте не является: проверка символа идёт после `instanceof
  Ok`, который покрывает обычный ответ.
- **Экспорт `Handler` из двух пакетов сбивает с толку.** → README
  `@nestling/app` называет `@nestling/app` местом импорта для кода с
  операциями, `@nestling/container` — для кода без них. `docs-audit`
  проверяет, что таблицы README совпадают.
- **Объявленный `redirect` и статус вызова могут разойтись.** → Документ
  показывает объявленный статус, и это записано в спеке; вызов без
  `status` берёт объявленный, поэтому расхождение требует явного второго
  значения в коде.
- **`Ok` без заголовков — ломающее изменение для двух примеров и семи
  глав гайда.** → Правки механические: `Ok.created(user, { Location })`
  становится `HttpResponse.of(Ok.created(user), { headers: { Location } })`.
- **`withClientIp()` за прокси отдаёт адрес прокси.** → JSDoc и README
  говорят это прямо; разбор `X-Forwarded-For` пишет приложение.

## Migration Plan

Change ломающий, обратной совместимости не остаётся.

1. `@nestling/operations`: конверт ответа, `Ok` без заголовков.
2. `@nestling/app`: `ResponseContext`, `normalizeResponse`, `HandlerMeta`,
   `Handler<C>`, слот `pipeline` у `implement`.
3. `@nestling/transport.http`: `HttpRequest`, `HttpResponse`, `Cookie`,
   стартовый контекст, слоты `httpEndpoint`, поле `redirect`, запись
   ответа, юниты.
4. `@nestling/openapi`: ответ 3xx с `Location`.
5. `@nestling/transport.nats`, `@nestling/transport.cli`,
   `@nestling/testing`: чтение `response.headers` убирается, появляется
   `input` в опциях вызова.
6. Примеры, гайд, README, `deferred.md`, пометка superseded в `ideas.md`.

## Open Questions

Нет. Два вопроса записи [2026-09-06] закрыты решениями 4 и 9: подписанные
cookie остаются вне V1, потоковый ответ получает заголовки до первого
кадра.
