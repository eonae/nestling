import type { BindMap, BindMark } from './binding.js';
import { assertHttpPath, computeHttpBinding } from './binding.js';
import type { HttpRequest } from './request.js';
import type { HttpResponse } from './response.js';
import { HttpTransport$ } from './token.js';

import type {
  AnyEndpointDefinition,
  AnyFail,
  AnyFailDefinition,
  AnyHandlerResult,
  AnyInput,
  AnyOutput,
  AnyPayload,
  CheckedHandlerFn,
  DeclaredOutputSync,
  DeclaredStatuses,
  EmptyInput,
  EndpointDefinition,
  FailsOf,
  HandlerClass,
  MissingFields,
  Pipeline,
  StreamForm,
  ValidateOutputForm,
} from '@nestlingjs/app';
import {
  assertLayerFailsDeclared,
  DEFAULT_INSTANCE,
  makeEndpoint,
} from '@nestlingjs/app';
import type {
  AnyOperation,
  DeclarationDoc,
  HandlerResultOf,
  HttpMethod,
  InferInput,
  InferOutput,
  InputFormOf,
  OperationFailsOf,
  OutputFormOf,
  RedirectStatus,
  StatusOf,
  SseConfig,
  SuccessStatus,
  ValidateHandlerFails,
  ValidateOperationFails,
} from '@nestlingjs/operations';

// Типы разметки пути и ключей `bind` (`PathParams`, `BindMap`) общие с
// секцией `http:` операции и живут в `@nestlingjs/operations`;
// `./binding.js` их реэкспортирует.

/**
 * Стартовый контекст декларации: поля, которые транспорт кладёт в контекст
 * до первого `.pre`-шага.
 *
 * Поле `http` есть у каждого HTTP-запроса. `rawBody: true` добавляет сырые
 * байты тела, `output: events(...)` — заголовок реконнекта
 * `Last-Event-ID`.
 */
export type StartContext<RB extends boolean | undefined, O = unknown> = {
  http: HttpRequest;
} & (RB extends true ? { rawBody: Uint8Array } : EmptyInput) &
  (O extends StreamForm<any, any, 'events'>
    ? { lastEventId?: string }
    : EmptyInput);

/**
 * Стартовый контекст HTTP-запроса — публичное имя {@link StartContext}.
 *
 * Им типизируются шаги транспорта: `makePipeline<HttpStartContext>()`
 * читает `ctx.input.http`. Такой пайплайн допустим в слоте `pipeline`
 * HTTP-декларации и не проходит в `implement`.
 *
 * @param RB - Пометка `rawBody` декларации
 * @param O - Форма `output` декларации
 *
 * @example
 * ```typescript
 * const httpBase = makePipeline<HttpStartContext>().pre(withClientIp());
 * ```
 */
export type HttpStartContext<
  RB extends boolean | undefined = undefined,
  O = unknown,
> = StartContext<RB, O>;

/**
 * Второй параметр HTTP-хендлера: поля пайплайна, сигнал отмены и запрос.
 *
 * Пересечение с `{ http }` добавляется независимо от слота `pipeline`,
 * поэтому декларация без пайплайна тоже даёт хендлеру `meta.http`.
 */
type HttpMetaOf<P extends AnyInput> = (P extends { payload: unknown }
  ? Omit<P, 'payload'>
  : P) & {
  signal: AbortSignal;
  http: HttpRequest;
};

/**
 * Хендлер анонимной HTTP-декларации.
 *
 * Отличий от `HandlerFn` два: `meta` содержит запрос, а результат
 * допускает `HttpResponse`. Хендлер, не читающий `http` и не возвращающий
 * `HttpResponse`, в этом слоте остаётся допустимым.
 */
export type HttpHandlerFn<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  E extends AnyFail = never,
  S extends SuccessStatus = never,
> = (
  payload: InferInput<I>,
  meta: HttpMetaOf<P>,
) => HttpDeclaredResult<O, E, S> | Promise<HttpDeclaredResult<O, E, S>>;

/**
 * Результат HTTP-хендлера: объявленные исходы плюс HTTP-форма ответа.
 *
 * Конверт `HttpResponse` несёт тот же статус: заголовки и cookie ответ
 * получает от транспорта, а исход по-прежнему объявляет декларация.
 */
type HttpDeclaredResult<
  O extends AnyOutput,
  E extends AnyFail,
  S extends SuccessStatus,
> =
  | DeclaredOutputSync<O, E, S>
  | HttpResponse<InferOutput<O>, DeclaredStatuses<O, S>>;

/** Класс-хендлер анонимной HTTP-декларации: класс с методом `handle` */
export type HttpHandlerClass<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  E extends AnyFail = never,
  S extends SuccessStatus = never,
> = new (...args: any[]) => { handle: HttpHandlerFn<I, O, P, E, S> };

/**
 * Результат HTTP-хендлера с любым отказом: ограничение слота `handler`
 * формы с функцией.
 *
 * Ограничение пропускает любой отказ, потому что множество отказов
 * проверяет бренд `ValidateHandlerFails` в возвращаемом типе.
 */
type AnyHttpResult<O extends AnyOutput, S extends SuccessStatus = never> =
  | HttpDeclaredResult<O, AnyFail, S>
  | Promise<HttpDeclaredResult<O, AnyFail, S>>;

/**
 * Слот `handler` анонимной формы: сигнатура `HttpHandlerFn` с проверкой
 * множества отказов в возвращаемом типе.
 *
 * Причина, по которой проверка стоит здесь, а не в слоте, — в JSDoc
 * `ValidateHandlerFails`.
 *
 * @param R - Тип результата, выведенный из тела хендлера
 */
type CheckedHttpHandlerFn<
  I extends AnyPayload,
  P extends AnyInput,
  E extends AnyFail,
  R,
> = (
  payload: InferInput<I>,
  meta: HttpMetaOf<P>,
) => R & ValidateHandlerFails<R, E>;

/**
 * Проверяет слот `pipeline`: всё, что пайплайн требует от внешнего
 * контекста, должен давать стартовый контекст декларации.
 *
 * Простой тип слота (`pipeline?: Pipeline<Start, P, PN>`) этого не
 * проверяет: `TReq` у `Pipeline` ковариантен через фантомное `$types`,
 * и `Pipeline<{ rawBody }, …>` присваивался бы слоту
 * `Pipeline<EmptyInput, …>` даже без пометки `rawBody: true`. Условный
 * тип в позиции слота решает это так же, как проверка точки композиции
 * в `@nestlingjs/app`.
 *
 * Форма литерала ошибки (`__error` и `missing` с типами полей) общая для
 * всех проверок пайплайна; `hint` называет действие, которое чинит ошибку.
 */
type ValidateStart<PR extends AnyInput, Start extends AnyInput> = [
  Start,
] extends [PR]
  ? unknown
  : {
      __error: 'Pipeline requires context that the start context does not provide';
      missing: MissingFields<Start, PR>;
      hint: "declare 'rawBody: true', or provide the fields from an outer layer";
    };

/** Тип элемента потоковой формы; по нему типизированы колбэки `sse` */
type InferStreamItem<O> =
  O extends StreamForm<any, infer TItem, any> ? TItem : never;

/**
 * Поля HTTP-декларации, которые принадлежат транспорту.
 *
 * Адреса среди них нет: метод называет имя конструктора, путь идёт его
 * первым аргументом. Параметр `Path` приходит оттуда литеральным типом:
 * из него выводятся path-параметры (`PathParams<Path>`), а по ним —
 * правило размещения «поле с именем path-параметра берётся из пути».
 */
export interface HttpEndpointDictionary<
  Path extends string = string,
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  RB extends boolean | undefined = undefined,
  PR extends AnyInput = AnyInput,
  E extends readonly AnyFailDefinition[] = [],
  PF extends AnyFail = never,
  S extends SuccessStatus = never,
> {
  /** Форма io для input: значение, `stream`/`events` или `multipart` */
  input?: I;

  /**
   * Форма io для output или развилка исходов `outputs({ … })`
   * (см. `ValidateOutputForm`)
   */
  output?: O & ValidateOutputForm<O>;

  /**
   * Статус единственного успешного исхода: `ok`, `created`, `accepted`
   * или `no_content`. Транспорт переводит его в код своей таблицей.
   *
   * Рядом с развилкой и рядом с `redirect` не объявляется. Не объявлен —
   * действует умолчание: `ok` при объявленном `output`, `no_content` без
   * него.
   *
   * @example
   * ```typescript
   * output: User, status: 'created'
   * ```
   */
  status?: S;

  /**
   * Настройки SSE-ответа: `id` и `event` кадра, период heartbeat.
   *
   * Допустимы только при `output: events(...)`. Имя события `error`
   * зарезервировано за отказом посреди потока.
   */
  sse?: SseConfig<InferStreamItem<O>>;

  /**
   * Объявленные отказы endpoint'а. Транспорт передаёт поле в `makeEndpoint`
   * без изменений: тот выводит из него тип отказов хендлера и проверяет
   * список при создании.
   */
  errors?: E;

  /**
   * Пометки размещения полей входа. Поле без пометки, не совпавшее с
   * path-параметром, берётся из query у методов без тела и из тела у
   * остальных.
   *
   * @example
   * ```typescript
   * bind: { expand: query(), tags: query({ multiple: true }) }
   * ```
   */
  bind?: BindMap<Path, I>;

  /**
   * Кладёт сырые байты тела в стартовый контекст
   * (`{ rawBody: Uint8Array }`), например для проверки подписи webhook.
   * Тело читается один раз: значение разбирается из тех же байтов; лимит
   * `maxBodySize` действует как обычно.
   *
   * Пометка меняет тип стартового контекста: без неё слой
   * `makePipeline<{ rawBody: Uint8Array }>()` в слоте `pipeline` не
   * компилируется.
   */
  rawBody?: RB;

  /**
   * Статус редиректа, который отдаёт endpoint.
   *
   * Поле объявляет редирект декларацией: по нему генератор документации
   * строит ответ 3xx с заголовком `Location`, а транспорт берёт статус,
   * если вызов `HttpResponse.redirect` его не задал. Хендлер, вернувший
   * редирект у декларации без этого поля, получает `internal_error`.
   *
   * Вместе с потоковой формой `output` не объявляется: у редиректа нет
   * тела.
   */
  redirect?: RedirectStatus;

  /**
   * Пайплайн endpoint'а. Шаги-классы допустимы: они попадают в `TNeeds`
   * декларации и получают зависимости из контейнера вместе с `deps`.
   */
  pipeline?: Pipeline<PR, P, PN, PF> & ValidateStart<PR, StartContext<RB, O>>;

  /**
   * Документация операции. Транспорт передаёт поле в `makeEndpoint` без
   * изменений; тот проверяет состав секции.
   *
   * @example
   * ```typescript
   * doc: { summary: 'Create user', tags: ['users'] }
   * ```
   */
  doc?: DeclarationDoc;

  /**
   * Причина, по которой endpoint выведен из-под политик сборки. Транспорт
   * передаёт поле в `makeEndpoint` без изменений; тот требует непустую
   * строку.
   */
  detached?: string;

  /**
   * Имя экземпляра транспорта, который обслуживает endpoint.
   *
   * По умолчанию `'default'`: приложение с одним HTTP про имена не пишет
   * ни строки. Второй экземпляр объявляется в корне
   * (`http({ name: 'admin', port: 3001 })`), и endpoint выбирает его
   * `on: 'admin'`.
   */
  on?: string;
}

/**
 * Словарь реализации операции по HTTP: только исполнение.
 *
 * Адрес, схемы, `errors` и `doc` берутся с операции. Полей, которыми
 * владеет операция, здесь нет вовсе: лишний ключ в объектном литерале
 * TypeScript отвергает и без объявления полей как `never`.
 *
 * Слот `pipeline` типизирован как у `implement`, без проверки стартового
 * контекста: операция несёт `rawBody` данными, а не типом, и проверка
 * отвергала бы реализацию webhook.
 */
export interface HttpImplementDictionary<
  C extends AnyOperation = AnyOperation,
  P extends AnyInput = AnyInput,
  PN = never,
  PF extends AnyFail = never,
> {
  /**
   * Пайплайн декларации. Шаги-классы допустимы: они попадают в `TNeeds`
   * декларации и получают зависимости из контейнера вместе с `deps`.
   *
   * Отказы, объявленные слоями пайплайна, обязаны входить в `errors:`
   * операции: контракт импортирует клиент, и он о пайплайне реализации не
   * знает. Нарушение — ошибка компиляции на этом слоте.
   */
  pipeline?: Pipeline<AnyInput, P, PN, PF> & ValidateOperationFails<C, PF>;

  /** Причина, по которой endpoint выведен из-под политик сборки */
  detached?: string;

  /** Имя экземпляра транспорта, обслуживающего endpoint; по умолчанию `'default'` */
  on?: string;
}

/** Поля, которые в реализации операции объявляет сама операция */
const OPERATION_OWNED = [
  'method',
  'path',
  'bind',
  'rawBody',
  'sse',
  'input',
  'output',
  'errors',
  'doc',
] as const;

/** Проверяет, что значение создано `makeRequest` */
function assertOperation(
  operation: unknown,
): asserts operation is AnyOperation {
  const name = (operation as { name?: unknown } | undefined)?.name;
  const kind = (operation as { kind?: unknown } | undefined)?.kind;

  if (typeof name !== 'string' || typeof kind !== 'string') {
    throw new TypeError(
      `httpEndpoint.implement(operation, { … }): the first argument must be ` +
        `an operation value created by makeRequest / makeCommand / makeEvent.`,
    );
  }
}

/**
 * Отвергает поля операции, повторно объявленные в реализации.
 *
 * Словарь таких полей не знает, поэтому типы их не компилируют. Проверка
 * нужна для JS-кода, где переданное поле иначе молча игнорировалось бы.
 */
function assertOperationOwned(
  declaration: Record<string, unknown>,
  operation: AnyOperation,
): void {
  for (const field of OPERATION_OWNED) {
    if (declaration[field] !== undefined) {
      throw new TypeError(
        `httpEndpoint.implement(${operation.name}, { … }): '${field}' ` +
          `belongs to the operation and cannot be redeclared by its ` +
          `implementation.`,
      );
    }
  }
}

/**
 * Конструктор HTTP-декларации по методу: `httpEndpoint.get`, `.head`,
 * `.post`, `.put`, `.patch`, `.delete`.
 *
 * Метод назван именем конструктора, путь идёт первым аргументом, словарь
 * транспорта — вторым. Надстройка над `makeEndpoint` из ядра: добавляет
 * поля транспорта, собирает `pattern` как `` `${method} ${path}` `` и
 * проверяет поля при создании. Общая часть деклараций (обе формы
 * `handler`, `resolve`, бренд) живёт в `makeEndpoint`. Реализацию
 * операции создаёт второй конструктор — {@link httpEndpoint.implement}.
 *
 * Сигнатур вызова две — по одной на форму хендлера, и это граница, за
 * которой TypeScript печатает только последнюю. Пока их две, диагностика
 * называет обе формы, и автор видит ту, в которой ошибся.
 *
 * Порядок задаёт резолвинг: форма с функцией стоит раньше формы с
 * классом. Аргумент `handler` контекстно-чувствителен, первый проход
 * резолвинга его не проверяет, и класс-форма, стоящая раньше, побеждала
 * бы; параметр функции оставался бы без контекстного типа.
 *
 * Одно объявление типа на шесть конструкторов: сигнатуры у них
 * одинаковы, и копии разошлись бы.
 *
 * @example Функция-хендлер: декларация исполнима сразу
 * ```typescript
 * export const Health = httpEndpoint.get('/health', {
 *   output: HealthOutput,
 *   pipeline: basePipeline,
 *   handler: async () => new Ok({ status: 'up' }),
 * });
 * ```
 *
 * @example Класс-хендлер: endpoint создаёт экземпляр сам
 * ```typescript
 * export const CreateUser = httpEndpoint.post('/users', {
 *   input: CreateUserInput,
 *   output: User,
 *   pipeline: basePipeline,
 *   handler: CreateUserHandler,
 * });
 * ```
 *
 * @example Пометка и сырые байты тела
 * ```typescript
 * export const StripeHook = httpEndpoint.post('/hooks/stripe', {
 *   input: HookEvent,
 *   bind: { verbose: query() },              // поле читается из query
 *   rawBody: true,                           // байты в стартовом контексте
 *   pipeline: compose(makePipeline<{ rawBody: Uint8Array }>()
 *     .pre(verifySignature(secret)), basePipeline),
 *   handler: async (event) => new Ok({ received: event.id }),
 * });
 * ```
 *
 * @throws {Error} Пустой путь, путь без ведущего `/`, повторяющееся имя
 * path-параметра, нарушение правила размещения (пометка на
 * path-параметре, `body()` у метода без тела, `bind`/path-параметр при
 * неструктурном `input`, `rawBody` при потоковой или multipart-форме)
 */
export interface HttpMethodConstructor {
  <
    Path extends string,
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = undefined,
    P extends AnyInput = AnyInput,
    PN = never,
    RB extends boolean | undefined = undefined,
    PR extends AnyInput = EmptyInput,
    E extends readonly AnyFailDefinition[] = [],
    PF extends AnyFail = never,
    S extends SuccessStatus = never,
    R extends AnyHttpResult<O, S> = AnyHttpResult<O, S>,
  >(
    path: Path,
    declaration: HttpEndpointDictionary<Path, I, O, P, PN, RB, PR, E, PF, S> & {
      handler: CheckedHttpHandlerFn<I, P, FailsOf<E> | NoInfer<PF>, R>;
    },
  ): EndpointDefinition<I, O, P, PN>;
  <
    Path extends string,
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = undefined,
    P extends AnyInput = AnyInput,
    PN = never,
    E extends readonly AnyFailDefinition[] = [],
    PF extends AnyFail = never,
    S extends SuccessStatus = never,
    C extends HttpHandlerClass<I, O, P, AnyFail, S> = HttpHandlerClass<
      I,
      O,
      P,
      AnyFail,
      S
    >,
    RB extends boolean | undefined = undefined,
    PR extends AnyInput = EmptyInput,
  >(
    path: Path,
    declaration: HttpEndpointDictionary<Path, I, O, P, PN, RB, PR, E, PF, S> & {
      handler: C &
        ValidateHandlerFails<HandlerResultOf<C>, FailsOf<E> | NoInfer<PF>>;
    },
  ): EndpointDefinition<I, O, P, PN | C>;
}

/**
 * Собирает конструктор одного HTTP-метода.
 *
 * Конструкторы различаются только строкой метода: она уходит в `pattern`,
 * в `computeHttpBinding` и в тексты ошибок. Поэтому тип от метода не
 * зависит, а шесть значений создаются одной фабрикой.
 *
 * @param method - HTTP-метод, который называет имя конструктора
 */
function makeMethodConstructor(method: HttpMethod): HttpMethodConstructor {
  // Имя конструктора в текстах ошибок — то, в котором его пишут:
  // `httpEndpoint.get`, а не `HTTP binding ({ method: 'GET' })`
  const name = `httpEndpoint.${method.toLowerCase()}`;

  const create = (
    path: string,
    declaration: HttpEndpointDictionary<
      string,
      any,
      any,
      any,
      unknown,
      boolean | undefined,
      any,
      readonly AnyFailDefinition[],
      AnyFail,
      SuccessStatus
    > & {
      handler: unknown;
    },
  ): AnyEndpointDefinition => {
    const { bind, rawBody, sse, redirect, on, ...rest } = declaration;

    assertHttpPath(path, `${name}('<path>', { … })`);

    // Карта вычисляется при создании декларации и хранится на ней: её читают
    // транспорт, OpenAPI и клиент, которому нужен один импорт без серверного
    // кода.
    const binding = computeHttpBinding({
      method,
      path,
      bind: bind as Readonly<Record<string, BindMark>> | undefined,
      rawBody,
      input: declaration.input,
      output: declaration.output,
      status: declaration.status,
      sse,
      redirect,
      where: `${name}('${path}', { … })`,
    });

    return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
      ...rest,
      // DI-токен, а не строка: приложение выводит список транспортов из графа,
      // поэтому ссылка должна совпадать со значением, под которым транспорт
      // зарегистрирован
      transport: HttpTransport$(on ?? DEFAULT_INSTANCE),
      pattern: `${method} ${path}`,
      binding,
    });
  };

  return create as HttpMethodConstructor;
}

/**
 * Создаёт HTTP-декларацию, реализующую операцию.
 *
 * Адрес, схемы, `errors` и `doc` берутся с операции; декларация задаёт
 * только исполнение. Bind-карта не пересчитывается: декларация получает то
 * же значение, которое несёт операция, поэтому клиент и сервер читают одну
 * карту.
 *
 * Результат — обычная HTTP-декларация: discovery, `policies`, визуализация
 * и пайплайн работают с ней как с любой другой.
 *
 * @param operation - Операция с секцией `http:`
 * @param declaration - Словарь исполнения: `pipeline`, `handler`,
 * `detached`, `on`
 * @returns Декларация-значение для `endpoints:` модуля
 * @throws {TypeError} Первый аргумент создан не `makeRequest`; поле
 * операции переобъявлено реализацией
 * @throws {Error} У операции нет секции `http:`
 *
 * @example
 * ```typescript
 * export const CreateUserImpl = httpEndpoint.implement(CreateUser, {
 *   pipeline: basePipeline,
 *   handler: CreateUserHandler,
 * });
 * ```
 */
function implementOperation<
  C extends AnyOperation,
  P extends AnyInput = AnyInput,
  PN = never,
  PF extends AnyFail = never,
  R extends AnyHandlerResult<
    OutputFormOf<C>,
    StatusOf<C>
  > = AnyHandlerResult<OutputFormOf<C>, StatusOf<C>>,
>(
  operation: C,
  declaration: HttpImplementDictionary<C, P, PN, PF> & {
    handler: CheckedHandlerFn<InputFormOf<C>, P, OperationFailsOf<C>, R>;
  },
): EndpointDefinition<InputFormOf<C>, OutputFormOf<C>, P, PN>;
function implementOperation<
  C extends AnyOperation,
  P extends AnyInput = AnyInput,
  PN = never,
  PF extends AnyFail = never,
  H extends HandlerClass<
    InputFormOf<C>,
    OutputFormOf<C>,
    P,
    AnyFail,
    StatusOf<C>
  > = HandlerClass<InputFormOf<C>, OutputFormOf<C>, P, AnyFail, StatusOf<C>>,
>(
  operation: C,
  declaration: HttpImplementDictionary<C, P, PN, PF> & {
    handler: H & ValidateHandlerFails<HandlerResultOf<H>, OperationFailsOf<C>>;
  },
): EndpointDefinition<InputFormOf<C>, OutputFormOf<C>, P, PN | H>;
function implementOperation(
  operation: unknown,
  declaration: HttpImplementDictionary<AnyOperation, any, unknown, AnyFail> & {
    handler: unknown;
  },
): AnyEndpointDefinition {
  assertOperation(operation);

  const { on, ...rest } = declaration as unknown as Record<string, unknown> & {
    on?: string;
  };

  assertOperationOwned(rest, operation);
  assertLayerFailsDeclared(
    rest.pipeline,
    operation.errors,
    `httpEndpoint.implement(${operation.name}, { … })`,
  );

  const binding = operation.http;
  if (!binding) {
    throw new Error(
      `httpEndpoint.implement(${operation.name}, { … }): the operation has ` +
        `no 'http:' section, so it carries no HTTP address. Declare ` +
        `'http: <METHOD> <path>' on it, or implement it on the bus with ` +
        `implement(${operation.name}, { … }).`,
    );
  }

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    transport: HttpTransport$(on ?? DEFAULT_INSTANCE),
    pattern: `${binding.method} ${binding.path}`,
    binding,
    input: operation.input,
    output: operation.output,
    // Исходы принадлежат операции: клиент и документ читают их оттуда же
    status: operation.status,
    errors: operation.errors,
    doc: operation.doc,
  });
}

/**
 * Пространство имён HTTP-деклараций: конструктор на каждый HTTP-метод и
 * реализация операции.
 *
 * Тип объявлен отдельно, чтобы состав проверялся при создании значения:
 * пропущенный метод стал бы ошибкой компиляции, а не тихой дырой в
 * публичном имени.
 */
interface HttpEndpointNamespace {
  get: HttpMethodConstructor;
  head: HttpMethodConstructor;
  post: HttpMethodConstructor;
  put: HttpMethodConstructor;
  patch: HttpMethodConstructor;
  delete: HttpMethodConstructor;
  implement: typeof implementOperation;
}

/**
 * Конструкторы HTTP-деклараций.
 *
 * Значение, а не функция: декларацию создаёт статик, названный
 * HTTP-методом ({@link HttpMethodConstructor}), а реализацию операции —
 * `implement`. Метод в имени вместо поля словаря убирает строку `'GET'`
 * из ряда других строк и ставит адрес первым аргументом.
 *
 * @example
 * ```typescript
 * const ListUsers = httpEndpoint.get('/users', { output: Users, handler });
 * const CreateUser = httpEndpoint.post('/users', { input, output, handler });
 * const Impl = httpEndpoint.implement(CreateUserOperation, { handler });
 * ```
 */
export const httpEndpoint = {
  get: makeMethodConstructor('GET'),
  head: makeMethodConstructor('HEAD'),
  post: makeMethodConstructor('POST'),
  put: makeMethodConstructor('PUT'),
  patch: makeMethodConstructor('PATCH'),
  delete: makeMethodConstructor('DELETE'),
  implement: implementOperation,
} satisfies HttpEndpointNamespace;
