import type { InjectionToken } from '@nestling/container';
import type {
  AnyEndpointDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  HandlerClass,
  HandlerFactory,
  HandlerFn,
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
 * Транспортный словарь HTTP-декларации.
 *
 * Легален и типизирован **только здесь**: пайплайн и хендлер остаются
 * транспорт-слепыми. `path` — литеральный тип, из которого выводятся
 * path-параметры (`PathParams<Path>`).
 */
export interface HttpEndpointDictionary<
  Path extends string = string,
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
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
   * Pipeline для этого endpoint. Классы-юниты допустимы: они попадают в
   * `TNeeds` декларации и гасятся вместе с `deps`.
   */
  pipeline?: Pipeline<AnyInput, P, PN>;

  // --- Точка расширения словаря: bind-карта (change `input-bind`, #21) ----
  //
  // Сюда придут канон размещения input и плоская карта «поле → место»:
  //   bind?: BindMap<Path, I>;   // 'id' → path, 'expand' → query, …
  //   rawBody?: boolean;         // сырые байты в стартовом контексте
  //
  // Тип `PathParams<Path>` уже выведен выше и станет источником правила
  // «имя поля совпало с path-параметром → путь». В этом change'е словарь
  // ограничен `method`/`path`, а сборка payload (`mergePayload`) не
  // меняется — иначе change съел бы предмет следующего.
}

/** Разбирает шаблон пути в список имён path-параметров (в порядке следования) */
function readPathParams(path: string): string[] {
  return path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

/**
 * Fail-fast транспортного словаря в момент создания декларации.
 *
 * Проверяется только то, что проверяемо без интроспекции схемы: Standard
 * Schema перечня ключей не отдаёт, поэтому «path-параметр без поля в схеме»
 * приезжает вместе с bind-картой (change `input-bind`).
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
 * @throws {Error} Пустой `path`, `path` без ведущего `/`, повторяющееся
 * имя path-параметра
 */
export function httpEndpoint<
  Path extends string,
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
>(
  declaration: HttpEndpointDictionary<Path, I, O, P, PN> & {
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
>(
  declaration: HttpEndpointDictionary<Path, I, O, P, PN> & {
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
>(
  declaration: HttpEndpointDictionary<Path, I, O, P, PN> & {
    deps?: undefined;
    handle: C;
  },
): EndpointDefinition<I, O, P, PN | C>;
export function httpEndpoint(
  declaration: HttpEndpointDictionary<string, any, any, any, unknown> & {
    deps?: InjectionToken[];
    handle: unknown;
  },
): AnyEndpointDefinition {
  const { method, path, ...rest } = declaration;

  assertHttpPath(method, path);

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    transport: 'http',
    pattern: `${method} ${path}`,
  });
}
