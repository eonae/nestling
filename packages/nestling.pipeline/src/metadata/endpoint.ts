import type {
  AnyFail,
  AnyFailDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  DeclarationDoc,
  FailsOf,
  Pipeline,
  ValidateOutputForm,
} from '../core';
import { assertDoc, assertFormSlots, isFailDefinition } from '../core';
import type { HandlerFn } from '../core/types';

import type { Constructor } from '@common/misc';
import type {
  InjectionToken,
  Token,
  UnwrapInjectionTokens,
} from '@nestling/container';
import { tokenId } from '@nestling/container';

/**
 * Токен транспорта, который обслуживает декларацию.
 *
 * Здесь тип не уточнён (`Token<any>`): `ITransport` живёт в
 * `@nestling/transport`, который сам зависит от этого пакета. Уточнённый
 * `Token<ITransport>` объявляет транспортный пакет
 * (`TransportToken`). Строковое имя транспорта для `Raw` и `EndpointMeta`
 * выводится из id токена функцией `transportNameOf`.
 */
export type TransportRef = Token<any>;

/**
 * Возвращает имя транспорта из id его токена.
 *
 * Токены транспортов называются `transport:http`: префикс отличает их от
 * пользовательских токенов в графе, а слоям пайплайна нужно короткое
 * `'http'`. У именованного экземпляра к имени добавляется его собственное
 * (`'http:admin'`); экземпляр по умолчанию называется как вид транспорта,
 * поэтому приложение с одним HTTP про имена не пишет ни строки.
 */
export const transportNameOf = (ref: TransportRef): string => {
  const id = tokenId(ref);
  const named = id.startsWith(TRANSPORT_PREFIX)
    ? id.slice(TRANSPORT_PREFIX.length)
    : id;

  return named.endsWith(DEFAULT_SUFFIX)
    ? named.slice(0, -DEFAULT_SUFFIX.length)
    : named;
};

/** Префикс id транспортного токена */
const TRANSPORT_PREFIX = 'transport:';

/**
 * Хвост id токена экземпляра по умолчанию.
 *
 * Имя экземпляра по умолчанию объявляет `@nestling/transport`, который
 * зависит от этого пакета; здесь оно повторено строкой, чтобы зависимость
 * не пошла в обратную сторону.
 */
const DEFAULT_SUFFIX = ':default';

/**
 * Symbol-метка декларации endpoint'а.
 *
 * Ставится неперечислимым свойством: спред, `Object.keys` и сериализация
 * её не видят, а discovery по ней отличает декларацию от сервиса или
 * конфига, случайно попавшего в `endpoints:`.
 */
const ENDPOINT_BRAND = Symbol.for('nestling:endpoint');

/**
 * Функция, которая по токену (строке или классу) возвращает инстанс.
 *
 * Под `App` это обёртка над контейнером; в тестах — любая функция.
 */
export type DependencyResolver = (token: InjectionToken) => unknown;

/**
 * Класс-хендлер: конструктор с методом `handle`.
 *
 * `implements` не нужен: сигнатура `handle` сверяется со схемами в точке
 * декларации.
 */
export type HandlerClass<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  E extends AnyFail = never,
> = Constructor<{ handle: HandlerFn<I, O, P, E> }>;

/**
 * Каррированная фабрика хендлера. Внешняя функция вызывается один раз, при
 * `resolve`, и получает зависимости; замыкание играет роль инстанса.
 */
export type HandlerFactory<
  D extends InjectionToken[],
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  E extends AnyFail = never,
> = (...deps: UnwrapInjectionTokens<D>) => HandlerFn<I, O, P, E>;

/**
 * Форма `handler: { deps, handle }`: каррированная фабрика с явным списком
 * токенов. Порядок аргументов `handle` совпадает с порядком `deps`.
 */
export interface HandlerWithDeps<
  D extends InjectionToken[],
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  E extends AnyFail = never,
> {
  /** Токены зависимостей в порядке аргументов `handle` */
  readonly deps: [...D];

  /** Фабрика: получает зависимости, возвращает хендлер */
  readonly handle: HandlerFactory<D, I, O, P, E>;
}

/**
 * Поле `handler` в любой из трёх форм: функция без зависимостей, объект
 * с `deps` и каррированной фабрикой, класс с методом `handle`.
 */
export type AnyEndpointHandler =
  | HandlerFn<any, any, any, any>
  | HandlerWithDeps<InjectionToken[], any, any, any, any>
  | HandlerClass<any, any, any, any>;

/**
 * Декларация endpoint'а: значение, описывающее операцию.
 *
 * Создаётся конструктором транспорта (`httpEndpoint`, `cliEndpoint`);
 * все они построены над `makeEndpoint`. Значение неизменяемо: `resolve`
 * возвращает новую декларацию и не трогает исходную.
 *
 * @template I - Форма входа: схема, примитив или форма io
 * @template O - Форма выхода
 * @template P - `input`, накопленный пайплайном
 * @template TNeeds - Зависимости, которым ещё нужен инстанс: токены `deps`,
 * класс-хендлер и классы-юниты пайплайна. `never` означает, что декларация
 * готова к выполнению; транспорты принимают только такую
 */
export interface EndpointDefinition<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  TNeeds = never,
> {
  /** Токен транспорта, обслуживающего endpoint (см. {@link TransportRef}) */
  readonly transport: TransportRef;
  readonly pattern: string;

  /**
   * Хендлер в той форме, в какой его объявила декларация: функция,
   * `{ deps, handle }` или класс.
   *
   * Читают его сборка и discovery: из объектной формы берутся токены
   * `deps`, класс-форма регистрируется провайдером модуля-объявителя.
   */
  readonly handler: AnyEndpointHandler;

  /**
   * Исполнимый хендлер запроса: одна форма для рантайма.
   *
   * Пока у декларации есть зависимости без инстансов (`TNeeds` не
   * `never`), здесь лежит заглушка, которая бросает понятную ошибку. До
   * транспорта такая декларация не доходит: её отсекают типы.
   */
  readonly handle: HandlerFn<I, O, P>;

  /** Схема или форма io входа */
  readonly input?: I;

  /** Схема или форма io выхода */
  readonly output?: O;

  /**
   * Пайплайн endpoint'а.
   *
   * Классы-юниты пайплайна попадают в `TNeeds` декларации и получают
   * инстансы тем же `resolve`, что и `deps`: транспорт получает пайплайн,
   * готовый к выполнению.
   */
  readonly pipeline?: Pipeline<AnyInput, P, never>;

  /**
   * Объявленные отказы endpoint'а: список определений `makeFail`.
   *
   * Поле не зависит от транспорта и читается ядром: из него выводится тип
   * отказов хендлера, а транспорт переносит его в `EndpointMeta`, по
   * которому пайплайн проверяет ответ-ошибку.
   */
  readonly errors?: readonly AnyFailDefinition[];

  /**
   * Данные транспорта о декларации: значение, которое кладёт транспортный
   * конструктор (для HTTP это bind-карта «поле: место»).
   *
   * Ядро переносит его на значение и сохраняет при `resolve`, но не
   * читает: понятий частей HTTP-запроса в `@nestling/pipeline` нет.
   * Типизирует и читает его тот транспорт, который его положил
   * (`httpBindingOf` в `@nestling/transport.http`).
   */
  readonly binding?: unknown;

  /**
   * Документация операции. Не зависит ни от транспорта, ни от формата
   * описания.
   *
   * Ядро переносит её как `binding` и не читает: выполнение запроса от
   * `doc` не зависит. Читают её генераторы описаний (`@nestling/openapi`),
   * поэтому полей, осмысленных только для одного формата, здесь нет.
   */
  readonly doc?: DeclarationDoc;

  /**
   * Причина, по которой endpoint выведен из-под политик сборки.
   *
   * Помеченный endpoint исключается из проверки всех политик приложения;
   * `App` печатает его на старте и кладёт в отчёт `check()`.
   */
  readonly detached?: string;

  /** @internal Существует только в типах; по нему выводится `TNeeds` */
  readonly $needs?: TNeeds;

  /**
   * Получает зависимости декларации и возвращает новую декларацию, готовую
   * к выполнению; исходная не меняется.
   *
   * Форма с резолвером работает для всех трёх форм `handler` и заодно
   * создаёт инстансы классов-юнитов пайплайна. Позиционная форма (готовые
   * инстансы в порядке `handler.deps`) удобна в тестах, но не подходит для
   * класс-хендлера и пайплайна с классами-юнитами.
   *
   * Это две перегрузки, а не один параметр-объединение, чтобы IDE
   * показывала формы раздельно.
   */
  resolve(resolver: DependencyResolver): EndpointDefinition<I, O, P, never>;
  /* eslint-disable-next-line @typescript-eslint/unified-signatures */
  resolve(instances: readonly unknown[]): EndpointDefinition<I, O, P, never>;
}

/** Декларация с любыми тип-параметрами */
export type AnyEndpointDefinition = EndpointDefinition<any, any, any, any>;

/**
 * Поля декларации, общие для всех транспортов.
 *
 * Транспортные конструкторы добавляют свои поля (`method` и `path` для
 * HTTP, `command` для CLI) и сами вычисляют `transport` и `pattern`.
 */
export interface EndpointOptions<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
> {
  /** Токен транспорта: его проставляет транспортный конструктор */
  transport: TransportRef;
  pattern: string;

  /** Форма io для input: значение, `stream`/`events` или `multipart` */
  input?: I;

  /**
   * Форма io для output.
   *
   * `ValidateOutputForm` запрещает здесь `multipart` и шаги item-цепочки,
   * меняющие тип элемента: оба конца выходного потока описаны схемой,
   * поэтому `.batch(...)` в `output` — ошибка компиляции.
   */
  output?: O & ValidateOutputForm<O>;

  /**
   * Объявленные отказы: список определений `makeFail`. Из него
   * выводится тип `E` хендлера: вернуть отказ вне списка нельзя.
   *
   * Проверяется при создании декларации: элемент не из `makeFail` и
   * повторяющийся код — ошибка сразу.
   */
  errors?: E;

  /**
   * Пайплайн endpoint'а. Классы-юниты допустимы: они попадают в `TNeeds`
   * декларации и получают инстансы вместе с `deps`.
   */
  pipeline?: Pipeline<AnyInput, P, PN>;

  /**
   * Данные транспорта о декларации. Переносятся на значение как есть; ядро
   * их не читает (см. `EndpointDefinition.binding`).
   */
  binding?: unknown;

  /**
   * Документация операции: `summary`, `description`, `tags`, `deprecated`,
   * успешный статус и `hidden: '<причина>'`.
   *
   * Проверяется при создании декларации: неизвестное поле, `hidden: true`
   * и статус не из списка успешных — ошибка сразу.
   *
   * @example
   * ```typescript
   * doc: { summary: 'List users', tags: ['users'], status: 'ok' }
   * ```
   */
  doc?: DeclarationDoc;

  /**
   * Причина, по которой endpoint выведен из-под политик сборки.
   *
   * Формы `detached: true` нет: тип — `string`, а не-строку и пустую
   * строку рантайм отвергает при создании декларации. Endpoint выпадает
   * из всех политик, поэтому причина должна быть видна в диффе, в выводе
   * старта и в отчёте `check()`.
   *
   * @example
   * ```typescript
   * detached: 'liveness-проба балансировщика: до auth не доходит'
   * ```
   */
  detached?: string;

  /**
   * @internal Зависимости принадлежат хендлеру: `handler: { deps, handle }`.
   * Поле на верхнем уровне словаря отвергается типом и рантаймом.
   */
  deps?: never;

  /** @internal Исполнение живёт в поле `handler` */
  handle?: never;
}

// ---------------------------------------------------------------------------
// Рантайм
// ---------------------------------------------------------------------------

type AnyHandler = HandlerFn<any, any, any>;

/** Форма `handler`, распознанная при создании декларации */
type HandlerForm =
  | { kind: 'fn'; fn: AnyHandler }
  | { kind: 'factory'; factory: (...deps: unknown[]) => AnyHandler }
  | { kind: 'class'; ctor: HandlerClass };

interface EndpointState {
  transport: TransportRef;
  pattern: string;
  input?: unknown;
  output?: unknown;
  pipeline?: Pipeline<AnyInput, AnyInput, unknown>;
  binding?: unknown;
  errors?: readonly AnyFailDefinition[];
  doc?: DeclarationDoc;
  detached?: string;
  /** Поле `handler` как объявлено */
  handler: AnyEndpointHandler;
  /** Токены объектной формы; у прочих форм пусто */
  deps: readonly InjectionToken[];
  form: HandlerForm;
  /** Хендлер с зависимостями; у формы `fn` есть сразу */
  handle?: AnyHandler;
}

/** Имя токена для текстов ошибок */
function describeToken(token: unknown): string {
  if (typeof token === 'function' && token.name) {
    return token.name;
  }

  const id = (token as { id?: unknown } | undefined)?.id;

  return typeof id === 'string' ? id : String(token);
}

/** Проверяет, что значение — класс с методом `handle` в прототипе */
function isHandlerClass(value: unknown): value is HandlerClass {
  if (typeof value !== 'function') {
    return false;
  }
  const proto = (value as { prototype?: { handle?: unknown } }).prototype;
  return Boolean(proto) && typeof proto?.handle === 'function';
}

/** Проверяет, что значение — объектная форма `{ deps, handle }` */
function isHandlerWithDeps(
  value: unknown,
): value is HandlerWithDeps<InjectionToken[], any, any, any, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { deps?: unknown }).deps) &&
    typeof (value as { handle?: unknown }).handle === 'function'
  );
}

/**
 * Распознаёт одну из трёх форм `handler`. Класс проверяется первым: у
 * функции-хендлера в прототипе нет `handle`, а у стрелочной функции нет
 * прототипа вовсе.
 */
function normalizeHandler(handler: unknown, pattern: string): HandlerForm {
  if (isHandlerClass(handler)) {
    return { kind: 'class', ctor: handler };
  }

  if (typeof handler === 'function') {
    return { kind: 'fn', fn: handler as AnyHandler };
  }

  if (isHandlerWithDeps(handler)) {
    return {
      kind: 'factory',
      factory: handler.handle as (...deps: unknown[]) => AnyHandler,
    };
  }

  throw new TypeError(
    `Endpoint '${pattern}': 'handler' must be a function (input, meta) => …, ` +
      `an object { deps: [...], handle: (...deps) => (input, meta) => … }, ` +
      `or a class with a handle() method.`,
  );
}

/**
 * Отвергает поля `deps` и `handle` на верхнем уровне словаря: типы их
 * запрещают, а JS-потребителю нужен текст, называющий поле `handler`.
 */
function assertNoLegacyFields(
  options: Record<string, unknown>,
  pattern: string,
): void {
  for (const field of ['deps', 'handle'] as const) {
    if (options[field] !== undefined) {
      throw new TypeError(
        `Endpoint '${pattern}': '${field}' is not a field of the ` +
          `declaration. Dependencies belong to the handler: write ` +
          `handler: { deps: [...], handle: (...deps) => (input, meta) => … }, ` +
          `or pass a function or a class as 'handler'.`,
      );
    }
  }
}

/**
 * Проверяет список `errors:` при создании декларации: каждый элемент
 * создан `makeFail`, коды не повторяются. Текст ошибки называет endpoint
 * и проблемное значение.
 */
function assertFailDefinitions(
  errors: unknown,
  pattern: string,
): asserts errors is readonly AnyFailDefinition[] | undefined {
  if (errors === undefined) {
    return;
  }

  const where = `Endpoint '${pattern}'`;

  if (!Array.isArray(errors)) {
    throw new TypeError(
      `${where}: 'errors' must be an array of makeFail() definitions.`,
    );
  }

  const seen = new Set<string>();
  for (const [index, definition] of errors.entries()) {
    if (!isFailDefinition(definition)) {
      throw new TypeError(
        `${where}: errors[${index}] is not a fail definition — ` +
          `expected a value created by makeFail().`,
      );
    }

    if (seen.has(definition.code)) {
      throw new Error(
        `${where}: duplicate error code '${definition.code}' in 'errors'.`,
      );
    }
    seen.add(definition.code);
  }
}

/**
 * Проверяет пометку `detached` при создании декларации: это непустая
 * строка с причиной. Типы уже запрещают `detached: true`; проверка нужна
 * JS-потребителям.
 */
function assertDetached(
  detached: unknown,
  pattern: string,
): asserts detached is string | undefined {
  if (detached === undefined) {
    return;
  }

  const where = `Endpoint '${pattern}'`;

  if (typeof detached !== 'string') {
    throw new TypeError(
      `${where}: 'detached' must be a non-empty string — the reason this ` +
        `handle is exempt from assembly policies. There is no ` +
        `'detached: true'.`,
    );
  }

  if (detached.trim().length === 0) {
    throw new Error(
      `${where}: 'detached' must state a reason; an empty string exempts ` +
        `the handle from every policy without saying why.`,
    );
  }
}

/** Заглушка `handle` для декларации, у которой ещё нет зависимостей */
function unresolvedHandler(state: EndpointState): AnyHandler {
  return () => {
    throw new Error(
      `Endpoint '${state.pattern}' has unresolved dependencies; ` +
        `call endpoint.resolve(resolver) before serving it ` +
        `(App does this automatically for endpoints declared in a module).`,
    );
  };
}

/**
 * Получает инстансы всех `handler.deps` через резолвер. Для каждого токена
 * результат обязателен: `undefined` и `null` — ошибка.
 */
function resolveWith(
  resolver: DependencyResolver,
  state: EndpointState,
): unknown[] {
  return state.deps.map((token) => {
    const instance = resolver(token);
    if (instance === undefined || instance === null) {
      throw new Error(
        `Endpoint '${state.pattern}': dependency '${describeToken(token)}' ` +
          `was not provided by the resolver.`,
      );
    }
    return instance;
  });
}

/**
 * Создаёт инстансы классов-юнитов пайплайна тем же резолвером, что и для
 * `deps`, чтобы транспорт получил пайплайн, готовый к выполнению.
 */
function bindPipeline(
  state: EndpointState,
  resolver: DependencyResolver | null,
): Pipeline<AnyInput, AnyInput, never> | undefined {
  if (!state.pipeline) {
    return undefined;
  }

  return state.pipeline.bind((ctor) => {
    if (!resolver) {
      throw new Error(
        `Endpoint '${state.pattern}': its pipeline uses the class unit ` +
          `'${describeToken(ctor)}', which positional resolve([...]) cannot ` +
          `materialize — use resolve(resolver) instead.`,
      );
    }
    return resolver(ctor);
  });
}

function resolveDefinition(
  state: EndpointState,
  argument: DependencyResolver | readonly unknown[],
): AnyEndpointDefinition {
  const positional = Array.isArray(argument);
  const resolver = positional ? null : (argument as DependencyResolver);

  // Хендлер уже есть (обычная функция или результат прошлого `resolve`):
  // остаётся создать инстансы классов-юнитов пайплайна. Поэтому повторный
  // `resolve` не вызывает фабрику второй раз.
  if (state.handle) {
    return buildDefinition({
      ...state,
      pipeline: bindPipeline(state, resolver),
    });
  }

  if (positional && state.form.kind === 'class') {
    throw new Error(
      `Endpoint '${state.pattern}': class handler ` +
        `'${describeToken(state.form.ctor)}' can only be materialized by ` +
        `resolve(resolver) — positional resolve([...]) has nothing to ` +
        `instantiate it with.`,
    );
  }

  let instances: unknown[];
  if (positional) {
    instances = [...(argument as readonly unknown[])];
    if (instances.length !== state.deps.length) {
      throw new Error(
        `Endpoint '${state.pattern}': resolve([...]) got ${instances.length} ` +
          `instance(s) for ${state.deps.length} declared dependency(-ies).`,
      );
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    instances = resolveWith(resolver!, state);
  }

  let handle: AnyHandler;
  switch (state.form.kind) {
    case 'fn': {
      handle = state.form.fn;
      break;
    }
    case 'factory': {
      handle = state.form.factory(...instances);
      break;
    }
    default: {
      const ctor = state.form.ctor;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const instance = resolver!(ctor) as { handle?: AnyHandler } | undefined;
      if (!instance || typeof instance.handle !== 'function') {
        throw new Error(
          `Endpoint '${state.pattern}': class handler ` +
            `'${describeToken(ctor)}' was not provided by the resolver.`,
        );
      }
      handle = instance.handle.bind(instance);
    }
  }

  return buildDefinition({
    ...state,
    pipeline: bindPipeline(state, resolver),
    handle,
  });
}

/** Собирает значение декларации: поля плюс неперечислимая метка */
function buildDefinition(state: EndpointState): AnyEndpointDefinition {
  const definition: Record<string, unknown> = {
    transport: state.transport,
    pattern: state.pattern,
    handler: state.handler,
    handle: state.handle ?? unresolvedHandler(state),
    resolve: (argument: DependencyResolver | readonly unknown[]) =>
      resolveDefinition(state, argument),
  };

  if (state.input !== undefined) {
    definition.input = state.input;
  }
  if (state.output !== undefined) {
    definition.output = state.output;
  }
  if (state.pipeline !== undefined) {
    definition.pipeline = state.pipeline;
  }
  // `binding`, `errors`, `doc` и `detached` переносятся как есть и
  // сохраняются при `resolve`: он строит новое значение из того же
  // `state`, поэтому декларация после `resolve` описывает то же, что и до
  if (state.binding !== undefined) {
    definition.binding = state.binding;
  }
  if (state.errors !== undefined) {
    definition.errors = state.errors;
  }
  if (state.doc !== undefined) {
    definition.doc = state.doc;
  }
  if (state.detached !== undefined) {
    definition.detached = state.detached;
  }

  Object.defineProperty(definition, ENDPOINT_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return definition as unknown as AnyEndpointDefinition;
}

/**
 * Проверяет, что значение — декларация endpoint'а, а не случайно попавший
 * в `endpoints:` сервис, конфиг или `undefined`.
 */
export function isEndpointDefinition(
  value: unknown,
): value is AnyEndpointDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[ENDPOINT_BRAND] === true
  );
}

/**
 * Токены, которые декларация запрашивает у контейнера через объектную
 * форму `handler: { deps, handle }`. У функции и класса — пусто:
 * зависимости класса читает контейнер из `@Injectable`.
 */
export function handlerDependenciesOf(
  definition: AnyEndpointDefinition,
): readonly InjectionToken[] {
  const { handler } = definition;

  return isHandlerWithDeps(handler) ? handler.deps : [];
}

/**
 * Класс-хендлер декларации, если она объявлена в класс-форме.
 *
 * Сборка регистрирует его провайдером модуля-объявителя: перечислять
 * класс в `providers:` не нужно.
 */
export function handlerClassOf(
  definition: AnyEndpointDefinition,
): HandlerClass | undefined {
  const { handler } = definition;

  return isHandlerClass(handler) ? handler : undefined;
}

/**
 * Создаёт декларацию endpoint'а: распознаёт форму `handler`, переносит
 * `errors:`, `doc` и `detached`, ставит метку и добавляет `resolve`.
 *
 * В пользовательском коде вместо него используются конструкторы
 * транспортов (`httpEndpoint`, `cliEndpoint`): они построены над
 * `makeEndpoint` и добавляют только свои поля.
 *
 * @example
 * ```typescript
 * const Ping = makeEndpoint({
 *   transport: HttpTransport$,          // токен транспорта, не строка
 *   pattern: 'GET /ping',
 *   output: PingOutput,
 *   pipeline: basePipeline,
 *   handler: async () => new Ok({ pong: true }),
 * });
 * ```
 */
export function makeEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
>(
  options: EndpointOptions<I, O, P, PN, E> & {
    handler: HandlerFn<I, O, P, FailsOf<E>>;
  },
): EndpointDefinition<I, O, P, PN>;
export function makeEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  D extends InjectionToken[] = InjectionToken[],
>(
  options: EndpointOptions<I, O, P, PN, E> & {
    handler: HandlerWithDeps<D, I, O, P, FailsOf<E>>;
  },
): EndpointDefinition<I, O, P, PN | D[number]>;
export function makeEndpoint<
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
>(
  options: EndpointOptions<I, O, P, PN, E> & {
    handler: C;
  },
): EndpointDefinition<I, O, P, PN | C>;
export function makeEndpoint(
  options: EndpointOptions<
    any,
    any,
    any,
    unknown,
    readonly AnyFailDefinition[]
  > & {
    handler: unknown;
  },
): AnyEndpointDefinition {
  assertNoLegacyFields(
    options as unknown as Record<string, unknown>,
    options.pattern,
  );
  const form = normalizeHandler(options.handler, options.pattern);
  assertFailDefinitions(options.errors, options.pattern);
  assertDetached(options.detached, options.pattern);
  // Правила `doc` общие для декларации и операции; отличается только
  // адресат в тексте ошибки
  assertDoc(options.doc, `Endpoint '${options.pattern}'`);
  // Формы io проверяются здесь, а не в конструкторах транспортов: правило
  // от транспорта не зависит, и `makeEndpoint` обязан проверять то же, что
  // `httpEndpoint` и `cliEndpoint`
  assertFormSlots(options.pattern, options.input, options.output);

  const state: EndpointState = {
    transport: options.transport,
    pattern: options.pattern,
    input: options.input,
    output: options.output,
    pipeline: options.pipeline as
      | Pipeline<AnyInput, AnyInput, unknown>
      | undefined,
    binding: options.binding,
    errors: options.errors,
    doc: options.doc,
    detached: options.detached,
    handler: options.handler as AnyEndpointHandler,
    deps: isHandlerWithDeps(options.handler) ? options.handler.deps : [],
    form,
    // Обычная функция готова сразу; остальные формы ждут resolve()
    handle: form.kind === 'fn' ? form.fn : undefined,
  };

  return buildDefinition(state);
}
