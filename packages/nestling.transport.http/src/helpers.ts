import type { BindMap, BindMark } from './binding.js';
import { assertHttpPath, computeHttpBinding } from './binding.js';
import { HttpTransport$ } from './token.js';

import type { InjectionToken } from '@nestling/container';
import type { HttpMethod, SseConfig } from '@nestling/contracts';
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

// Разметка пути и ключи `bind` (`PathParams`, `BindMap`) — общие с секцией
// `http:` контракта: правило размещения одно на оба носителя, поэтому и типы
// живут в одном месте. Реэкспортирует их `./binding.js` вместе с остальной
// декларативной половиной карты.

/**
 * Стартовый контекст декларации — то, что транспорт кладёт в контекст ещё до
 * первого pre-юнита.
 *
 * `rawBody: true` добавляет туда сырые байты тела; `output: events(...)` —
 * заголовок реконнекта `Last-Event-ID`. Оба поля приезжают одним и тем же
 * механизмом: изобретать под реконнект отдельный канал незачем.
 */
export type StartContext<
  RB extends boolean | undefined,
  O = unknown,
> = (RB extends true ? { rawBody: Uint8Array } : EmptyInput) &
  (O extends StreamForm<any, any, 'events'>
    ? { lastEventId?: string }
    : EmptyInput);

/**
 * Сторож слота `pipeline`: требования пайплайна к внешнему контексту должны
 * покрываться стартовым контекстом декларации.
 *
 * Простой типизации слота (`pipeline?: Pipeline<Start, P, PN>`)
 * **недостаточно**: `TReq` у `Pipeline` ведёт себя ковариантно через фантомное
 * `$types`, поэтому `Pipeline<{ rawBody }, …>` присвоился бы слоту
 * `Pipeline<EmptyInput, …>` и забытая пометка `rawBody: true` прошла бы молча.
 * Условный тип в позиции слота — та же техника, которой пользуется сторож
 * точки композиции в `@nestling/pipeline`.
 *
 * Форма литерала — общая для всех точек проверки pipeline (`__error` +
 * `missing` рекордом полей с типами); `hint` добавлен здесь потому, что
 * называет конкретное действие, а не только проблему.
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

/** Тип элемента потоковой формы — им типизируются колбэки `sse` */
type InferStreamItem<O> =
  O extends StreamForm<any, infer TItem, any> ? TItem : never;

/**
 * Транспортный словарь HTTP-декларации.
 *
 * Легален и типизирован **только здесь**: пайплайн и хендлер остаются
 * транспорт-слепыми. `path` — литеральный тип, из которого выводятся
 * path-параметры (`PathParams<Path>`): они же — источник правила размещения
 * «имя поля совпало с path-параметром → путь».
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
  /** HTTP-метод ручки */
  method: HttpMethod;

  /** Шаблон пути; path-параметры объявляются `:name` */
  path: Path;

  /** Форма io для input: значение, `stream`/`events` или `multipart` */
  input?: I;

  /** Форма io для output (см. `ValidateOutputForm`) */
  output?: O & ValidateOutputForm<O>;

  /**
   * SSE-специфика ответа: `id`/`event` кадра и период heartbeat.
   *
   * Легальна только при `output: events(...)` — форма транспортно
   * нейтральна, а всё специфичное для провода объявляется здесь.
   * Имя события `error` зарезервировано за mid-stream отказом.
   */
  sse?: SseConfig<InferStreamItem<O>>;

  /**
   * Объявленные отказы ручки. Транспорт поле не интерпретирует — только
   * пробрасывает в `makeEndpoint`, который выводит из него тип отказов
   * хендлера и проверяет список при создании.
   */
  errors?: E;

  /**
   * Пометки размещения: «поле → место». Всё, что не помечено и не совпало с
   * path-параметром, размещается по канону — query для методов без тела,
   * body для остальных.
   *
   * @example
   * ```typescript
   * bind: { expand: query(), tags: query({ multiple: true }) }
   * ```
   */
  bind?: BindMap<Path, I>;

  /**
   * Сырые байты тела в стартовом контексте (`{ rawBody: Uint8Array }`) —
   * для проверки webhook-подписей. Тело читается один раз, значение
   * парсится из тех же байтов; лимит `maxBodySize` действует как обычно.
   *
   * Меняет тип стартового контекста: слой, объявленный
   * `makePipeline<{ rawBody: Uint8Array }>()`, без этой пометки не
   * компилируется.
   */
  rawBody?: RB;

  /**
   * Pipeline для этого endpoint. Классы-юниты допустимы: они попадают в
   * `TNeeds` декларации и гасятся вместе с `deps`.
   */
  pipeline?: Pipeline<PR, P, PN> & ValidateStart<PR, StartContext<RB, O>>;

  /**
   * Причина вывода ручки из-под инвариантов сборки. Транспорт поле не
   * интерпретирует — только пробрасывает в `makeEndpoint`, который требует
   * непустую строку (формы `detached: true` не существует).
   */
  detached?: string;
}

/**
 * Конструктор HTTP-деклараций.
 *
 * Тонкая надстройка над kernel-примитивом `makeEndpoint`: добавляет
 * транспортный словарь, собирает `pattern` как `` `${method} ${path}` `` и
 * проверяет словарь при создании. Вся общая машинерия деклараций (`deps`,
 * три формы `handle`, `resolve`, бренд) живёт в `makeEndpoint`.
 *
 * @example Голая функция — декларация исполнима сразу
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
 * @example Каррированная фабрика — внешний вызов один раз на сборке
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
 * @example Класс-хендлер — форма подключения DI (регистрируется в `providers:`)
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
 *   bind: { verbose: query() },              // вытащить из тела в query
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
  declaration: HttpEndpointDictionary<
    string,
    any,
    any,
    any,
    unknown,
    boolean | undefined,
    any,
    readonly AnyFailDefinition[]
  > & {
    deps?: InjectionToken[];
    handle: unknown;
  },
): AnyEndpointDefinition {
  const { method, path, bind, rawBody, sse, ...rest } = declaration;

  assertHttpPath(path, `httpEndpoint({ method: '${method}', … })`);

  // Канон разворачивается здесь, в момент создания значения: карта обязана
  // ехать на декларации — её читают транспорт, OpenAPI и клиент, а клиенту
  // она нужна из одного импорта, без серверного кода.
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
    // Токен, а не строка: множество транспортов приложения выводится из
    // графа, поэтому ссылка обязана быть тем же значением, которым
    // транспорт зарегистрирован
    transport: HttpTransport$,
    pattern: `${method} ${path}`,
    binding,
  });
}
