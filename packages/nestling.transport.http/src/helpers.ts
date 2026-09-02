import type { BindMap, BindMark } from './binding.js';
import { assertHttpPath, computeHttpBinding } from './binding.js';
import { HttpTransport$ } from './token.js';

import type { InjectionToken } from '@nestling/container';
import type {
  AnyOperation,
  DeclarationDoc,
  HttpMethod,
  InputFormOf,
  OperationFailsOf,
  OutputFormOf,
  SseConfig,
} from '@nestling/operations';
import type {
  AnyEndpointDefinition,
  AnyFailDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  EmptyInput,
  EndpointDefinition,
  FailsOf,
  HandlerClass,
  HandlerFactory,
  HandlerFn,
  MissingFields,
  Pipeline,
  StreamForm,
  ValidateOutputForm,
} from '@nestling/pipeline';
import { makeEndpoint } from '@nestling/pipeline';
import { DEFAULT_INSTANCE } from '@nestling/transport';

// Типы разметки пути и ключей `bind` (`PathParams`, `BindMap`) общие с
// секцией `http:` операции и живут в `@nestling/operations`;
// `./binding.js` их реэкспортирует.

/**
 * Стартовый контекст декларации: поля, которые транспорт кладёт в контекст
 * до первого `.pre`-юнита.
 *
 * `rawBody: true` добавляет сырые байты тела, `output: events(...)` —
 * заголовок реконнекта `Last-Event-ID`.
 */
export type StartContext<
  RB extends boolean | undefined,
  O = unknown,
> = (RB extends true ? { rawBody: Uint8Array } : EmptyInput) &
  (O extends StreamForm<any, any, 'events'>
    ? { lastEventId?: string }
    : EmptyInput);

/**
 * Проверяет слот `pipeline`: всё, что пайплайн требует от внешнего
 * контекста, должен давать стартовый контекст декларации.
 *
 * Простой тип слота (`pipeline?: Pipeline<Start, P, PN>`) этого не
 * проверяет: `TReq` у `Pipeline` ковариантен через фантомное `$types`,
 * и `Pipeline<{ rawBody }, …>` присваивался бы слоту
 * `Pipeline<EmptyInput, …>` даже без пометки `rawBody: true`. Условный
 * тип в позиции слота решает это так же, как проверка точки композиции
 * в `@nestling/pipeline`.
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
 * Только здесь известны метод и путь; пайплайн и хендлер о транспорте не
 * знают. `path` — литеральный тип: из него выводятся path-параметры
 * (`PathParams<Path>`), а по ним — правило размещения «поле с именем
 * path-параметра берётся из пути».
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
> {
  /** HTTP-метод endpoint'а */
  method: HttpMethod;

  /** Шаблон пути; path-параметры объявляются `:name` */
  path: Path;

  /** Форма io для input: значение, `stream`/`events` или `multipart` */
  input?: I;

  /** Форма io для output (см. `ValidateOutputForm`) */
  output?: O & ValidateOutputForm<O>;

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
   * Пайплайн endpoint'а. Юниты-классы допустимы: они попадают в `TNeeds`
   * декларации и получают зависимости из контейнера вместе с `deps`.
   */
  pipeline?: Pipeline<PR, P, PN> & ValidateStart<PR, StartContext<RB, O>>;

  /**
   * Документация операции. Транспорт передаёт поле в `makeEndpoint` без
   * изменений; тот проверяет состав секции.
   *
   * @example
   * ```typescript
   * doc: { summary: 'Create user', tags: ['users'], status: 'CREATED' }
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
 * Операция-форма HTTP-декларации: адрес, схемы и `errors` берутся с
 * операции, а декларация задаёт только `pipeline`, `deps` и `handle`.
 *
 * Результат — обычная HTTP-декларация: discovery, `policies`, визуализация
 * и пайплайн работают с ней как с любой другой.
 *
 * Слот `pipeline` типизирован как у `implement`, без проверки стартового
 * контекста: операция несёт `rawBody` данными, а не типом, и проверка
 * отвергала бы реализацию webhook.
 */
export interface HttpOperationDictionary<
  C extends AnyOperation = AnyOperation,
  P extends AnyInput = AnyInput,
  PN = never,
> {
  /** Операция, объявленный `makeRequest` с секцией `http:` */
  operation: C;

  /**
   * Пайплайн декларации. Юниты-классы допустимы: они попадают в `TNeeds`
   * декларации и получают зависимости из контейнера вместе с `deps`.
   */
  pipeline?: Pipeline<AnyInput, P, PN>;

  /** Причина, по которой endpoint выведен из-под политик сборки */
  detached?: string;

  /** Имя экземпляра транспорта, обслуживающего endpoint; по умолчанию `'default'` */
  on?: string;

  /** @internal адрес операции принадлежит операции */
  method?: never;

  /** @internal адрес операции принадлежит операции */
  path?: never;

  /** @internal размещение полей принадлежит операции */
  bind?: never;

  /** @internal размещение полей принадлежит операции */
  rawBody?: never;

  /** @internal настройки SSE принадлежат операции */
  sse?: never;

  /** @internal интерфейс операции принадлежит операции */
  input?: never;

  /** @internal интерфейс операции принадлежит операции */
  output?: never;

  /** @internal интерфейс операции принадлежит операции */
  errors?: never;

  /**
   * @internal документация операции принадлежит операции: две реализации
   * одного операции не могут описывать его по-разному
   */
  doc?: never;
}

/** Поля, которые в операция-форме объявляет сама операция */
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
      `httpEndpoint({ operation, … }): 'operation' must be a value ` +
        `created by makeRequest / makeCommand / makeEvent.`,
    );
  }
}

/**
 * Отвергает поля операции, повторно объявленные в реализации.
 *
 * Типы такое не компилируют; проверка нужна для JS-кода, где переданное
 * поле иначе молча игнорировалось бы.
 */
function assertOperationOwned(
  declaration: Record<string, unknown>,
  operation: AnyOperation,
): void {
  for (const field of OPERATION_OWNED) {
    if (declaration[field] !== undefined) {
      throw new TypeError(
        `httpEndpoint({ operation: ${operation.name}, … }): '${field}' ` +
          `belongs to the operation and cannot be redeclared by its ` +
          `implementation.`,
      );
    }
  }
}

/**
 * Строит декларацию из операции: bind-карта, схемы и `errors` берутся с
 * него.
 *
 * Карта не пересчитывается: декларация получает то же значение, которое
 * несёт операция, поэтому клиент и сервер читают одну и ту же карту.
 */
function fromOperation(
  declaration: Record<string, unknown> & { operation: unknown },
): AnyEndpointDefinition {
  const { operation, on, ...rest } = declaration as Record<string, unknown> & {
    operation: unknown;
    on?: string;
  };

  assertOperation(operation);
  assertOperationOwned(rest, operation);

  const binding = operation.http;
  if (!binding) {
    throw new Error(
      `httpEndpoint({ operation: ${operation.name}, … }): the operation has ` +
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
    errors: operation.errors,
    doc: operation.doc,
  });
}

/**
 * Создаёт HTTP-декларацию.
 *
 * Надстройка над `makeEndpoint` из ядра: добавляет поля транспорта,
 * собирает `pattern` как `` `${method} ${path}` `` и проверяет поля при
 * создании. Общая часть деклараций (`deps`, три формы `handle`, `resolve`,
 * бренд) живёт в `makeEndpoint`.
 *
 * @example Функция-хендлер: декларация исполнима сразу
 * ```typescript
 * export const Health = httpEndpoint({
 *   method: 'GET',
 *   path: '/health',
 *   output: HealthOutput,
 *   pipeline: basePipeline,
 *   handle: async () => Ok.of({ status: 'up' }),
 * });
 * ```
 *
 * @example Фабрика хендлера: внешний вызов выполняется один раз на сборке
 * ```typescript
 * export const GetUser = httpEndpoint({
 *   method: 'GET',
 *   path: '/users/:id',
 *   input: GetUserInput,
 *   output: User,
 *   pipeline: basePipeline,
 *   deps: [UserService],
 *   handle: (users) => async ({ id }) => new Ok(await users.getById(id)),
 * });
 * ```
 *
 * @example Класс-хендлер: регистрируется в `providers:`
 * ```typescript
 * export const CreateUser = httpEndpoint({
 *   method: 'POST',
 *   path: '/users',
 *   input: CreateUserInput,
 *   output: User,
 *   pipeline: basePipeline,
 *   handle: CreateUserHandler,
 * });
 * ```
 *
 * @example Пометка и сырые байты тела
 * ```typescript
 * export const StripeHook = httpEndpoint({
 *   method: 'POST',
 *   path: '/hooks/stripe',
 *   input: HookEvent,
 *   bind: { verbose: query() },              // поле читается из query
 *   rawBody: true,                           // байты в стартовом контексте
 *   pipeline: compose(makePipeline<{ rawBody: Uint8Array }>()
 *     .pre(verifySignature(secret)), basePipeline),
 *   handle: async (event) => Ok.of({ received: event.id }),
 * });
 * ```
 *
 * @throws {Error} Пустой `path`, `path` без ведущего `/`, повторяющееся
 * имя path-параметра, нарушение правила размещения (пометка на
 * path-параметре, `body()` у метода без тела, `bind`/path-параметр при
 * неструктурном `input`, `rawBody` при потоковой или multipart-форме)
 */
/**
 * Порядок перегрузок задают два ограничения.
 *
 * Резолвинг: форма с функцией-хендлером стоит раньше формы с
 * класс-хендлером. Аргумент `handle` контекстно-чувствителен, первый проход
 * резолвинга его не проверяет, и класс-форма, стоящая раньше, побеждала бы;
 * параметр функции оставался бы без контекстного типа.
 *
 * Диагностика: при числе перегрузок больше трёх TypeScript печатает ошибку
 * только последней. Последней стоит класс-форма, поэтому к настоящей
 * причине (несошедшийся `bind`, литерал `__error` слота `pipeline`)
 * добавляется шум про `HandlerClass`.
 *
 * Операция-форма стоит первой: её поля не пересекаются с анонимной формой
 * (`operation` против `method` и `path`), поэтому на резолвинг она не
 * влияет.
 */
export function httpEndpoint<
  C extends AnyOperation,
  P extends AnyInput = AnyInput,
  PN = never,
>(
  declaration: HttpOperationDictionary<C, P, PN> & {
    deps?: undefined;
    handle: HandlerFn<InputFormOf<C>, OutputFormOf<C>, P, OperationFailsOf<C>>;
  },
): EndpointDefinition<InputFormOf<C>, OutputFormOf<C>, P, PN>;
export function httpEndpoint<
  C extends AnyOperation,
  P extends AnyInput = AnyInput,
  PN = never,
  D extends InjectionToken[] = InjectionToken[],
>(
  declaration: HttpOperationDictionary<C, P, PN> & {
    deps: [...D];
    handle: HandlerFactory<
      D,
      InputFormOf<C>,
      OutputFormOf<C>,
      P,
      OperationFailsOf<C>
    >;
  },
): EndpointDefinition<InputFormOf<C>, OutputFormOf<C>, P, PN | D[number]>;
export function httpEndpoint<
  C extends AnyOperation,
  P extends AnyInput = AnyInput,
  PN = never,
  H extends HandlerClass<
    InputFormOf<C>,
    OutputFormOf<C>,
    P,
    OperationFailsOf<C>
  > = HandlerClass<InputFormOf<C>, OutputFormOf<C>, P, OperationFailsOf<C>>,
>(
  declaration: HttpOperationDictionary<C, P, PN> & {
    deps?: undefined;
    handle: H;
  },
): EndpointDefinition<InputFormOf<C>, OutputFormOf<C>, P, PN | H>;
export function httpEndpoint<
  Path extends string,
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  RB extends boolean | undefined = undefined,
  PR extends AnyInput = EmptyInput,
  E extends readonly AnyFailDefinition[] = [],
>(
  declaration: HttpEndpointDictionary<Path, I, O, P, PN, RB, PR, E> & {
    deps?: undefined;
    handle: HandlerFn<I, O, P, FailsOf<E>>;
  },
): EndpointDefinition<I, O, P, PN>;
export function httpEndpoint<
  Path extends string,
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  D extends InjectionToken[] = InjectionToken[],
  RB extends boolean | undefined = undefined,
  PR extends AnyInput = EmptyInput,
  E extends readonly AnyFailDefinition[] = [],
>(
  declaration: HttpEndpointDictionary<Path, I, O, P, PN, RB, PR, E> & {
    deps: [...D];
    handle: HandlerFactory<D, I, O, P, FailsOf<E>>;
  },
): EndpointDefinition<I, O, P, PN | D[number]>;
export function httpEndpoint<
  Path extends string,
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  C extends HandlerClass<I, O, P, FailsOf<E>> = HandlerClass<
    I,
    O,
    P,
    FailsOf<E>
  >,
  RB extends boolean | undefined = undefined,
  PR extends AnyInput = EmptyInput,
>(
  declaration: HttpEndpointDictionary<Path, I, O, P, PN, RB, PR, E> & {
    deps?: undefined;
    handle: C;
  },
): EndpointDefinition<I, O, P, PN | C>;
export function httpEndpoint(
  declaration: (
    | HttpEndpointDictionary<
        string,
        any,
        any,
        any,
        unknown,
        boolean | undefined,
        any,
        readonly AnyFailDefinition[]
      >
    | HttpOperationDictionary<any, any, unknown>
  ) & {
    deps?: InjectionToken[];
    handle: unknown;
  },
): AnyEndpointDefinition {
  // Операция-форму отличает ключ `operation`: в анонимной форме его нет
  if ('operation' in declaration) {
    return fromOperation(
      declaration as unknown as Record<string, unknown> & {
        operation: unknown;
      },
    );
  }

  const { method, path, bind, rawBody, sse, on, ...rest } = declaration;

  assertHttpPath(path, `httpEndpoint({ method: '${method}', … })`);

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
    sse,
    where: `httpEndpoint({ method: '${method}', path: '${path}' })`,
  });

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    // Токен, а не строка: приложение выводит список транспортов из графа,
    // поэтому ссылка должна совпадать со значением, под которым транспорт
    // зарегистрирован
    transport: HttpTransport$(on ?? DEFAULT_INSTANCE),
    pattern: `${method} ${path}`,
    binding,
  });
}
