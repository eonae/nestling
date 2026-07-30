import type { BindMark } from './binding.js';
import { computeHttpBinding, readPathParams } from './binding.js';

import type { InjectionToken } from '@nestling/container';
import type {
  AnyEndpointDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  EmptyInput,
  EndpointDefinition,
  HandlerClass,
  HandlerFactory,
  HandlerFn,
  InferInput,
  MissingFields,
  Pipeline,
} from '@nestling/pipeline';
import { makeEndpoint } from '@nestling/pipeline';
import type { HTTPMethod } from 'find-my-way';

/**
 * Имена path-параметров шаблона (`:param`-сегментов).
 *
 * @example
 * ```typescript
 * PathParams<'/users/:id/orders/:orderId'>  // 'id' | 'orderId'
 * PathParams<'/health'>                     // never
 * ```
 */
export type PathParams<Path extends string> =
  Path extends `${string}:${infer Rest}`
    ? Rest extends `${infer Name}/${infer Tail}`
      ? Name | PathParams<`/${Tail}`>
      : Rest
    : never;

/**
 * Ключи, которые можно пометить в `bind`: поля схемы `input` за вычетом
 * path-параметров шаблона.
 *
 * Рантайм перечня ключей у Standard Schema не получит, но **типы его
 * знают** — этой асимметрией пользуемся: опечатка в имени поля и пометка на
 * path-параметре становятся ошибками компиляции. Непрозрачный `input`
 * (`AnyPayload` без вывода ключей) деградирует до отсутствия подсказок, а
 * не до ошибки: там правила проверяет рантайм.
 */
export type BindMap<Path extends string, I> = [
  Extract<keyof InferInput<I>, string>,
] extends [never]
  ? Readonly<Record<string, BindMark>>
  : Partial<
      Readonly<
        Record<
          Exclude<Extract<keyof InferInput<I>, string>, PathParams<Path>>,
          BindMark
        >
      >
    >;

/**
 * Стартовый контекст декларации — то, что транспорт кладёт в контекст ещё до
 * первого pre-юнита. `rawBody: true` добавляет туда сырые байты тела.
 */
export type StartContext<RB extends boolean | undefined> = RB extends true
  ? { rawBody: Uint8Array }
  : EmptyInput;

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
> {
  /** HTTP-метод ручки */
  method: HTTPMethod;

  /** Шаблон пути; path-параметры объявляются `:name` */
  path: Path;

  /** Schema или модификатор для input */
  input?: I;

  /** Конфигурация выходных данных */
  output?: O;

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
  pipeline?: Pipeline<PR, P, PN> & ValidateStart<PR, StartContext<RB>>;
}

/**
 * Fail-fast шаблона пути в момент создания декларации.
 *
 * Проверяется только то, что проверяемо без интроспекции схемы: Standard
 * Schema перечня ключей не отдаёт, поэтому «path-параметр объявлен в
 * шаблоне, но поля с таким именем в схеме нет» не диагностируется —
 * известное ограничение, кандидат на проверку в `@nestling/openapi`, где
 * вендор-конвертер структуру схемы уже знает. Правила размещения (пометки,
 * `rawBody`, неструктурный `input`) проверяет `computeHttpBinding`.
 */
function assertHttpPath(method: string, path: unknown): asserts path is string {
  const where = `httpEndpoint({ method: '${method}', … })`;

  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(`${where}: 'path' must be a non-empty string.`);
  }

  if (!path.startsWith('/')) {
    throw new Error(`${where}: 'path' must start with '/', got '${path}'.`);
  }

  const seen = new Set<string>();
  for (const name of readPathParams(path)) {
    if (seen.has(name)) {
      throw new Error(
        `${where}: path parameter ':${name}' is declared twice in '${path}'.`,
      );
    }
    seen.add(name);
  }
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
>(
  declaration: HttpEndpointDictionary<Path, I, O, P, PN, RB, PR> & {
    deps?: undefined;
    handle: HandlerFn<I, O, P>;
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
>(
  declaration: HttpEndpointDictionary<Path, I, O, P, PN, RB, PR> & {
    deps: [...D];
    handle: HandlerFactory<D, I, O, P>;
  },
): EndpointDefinition<I, O, P, PN | D[number]>;
export function httpEndpoint<
  Path extends string,
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  C extends HandlerClass<I, O, P> = HandlerClass<I, O, P>,
  RB extends boolean | undefined = undefined,
  PR extends AnyInput = EmptyInput,
>(
  declaration: HttpEndpointDictionary<Path, I, O, P, PN, RB, PR> & {
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
    any
  > & {
    deps?: InjectionToken[];
    handle: unknown;
  },
): AnyEndpointDefinition {
  const { method, path, bind, rawBody, ...rest } = declaration;

  assertHttpPath(method, path);

  // Канон разворачивается здесь, в момент создания значения: карта обязана
  // ехать на декларации — её читают транспорт, OpenAPI и клиент, а клиенту
  // она нужна из одного импорта, без серверного кода.
  const binding = computeHttpBinding({
    method,
    path,
    bind: bind as Readonly<Record<string, BindMark>> | undefined,
    rawBody,
    input: declaration.input,
  });

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    transport: 'http',
    pattern: `${method} ${path}`,
    binding,
  });
}
