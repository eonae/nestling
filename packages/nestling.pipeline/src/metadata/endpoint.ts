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
  TokenString,
  UnwrapInjectionTokens,
} from '@nestling/container';

/**
 * Ссылка декларации на её транспорт — **токен**, а не строка.
 *
 * Ядро типизирует его неуточнённо (`TokenString<any>`), потому что
 * `ITransport` живёт в `@nestling/transport`, который зависит от ядра:
 * уточнение до `TokenString<ITransport>` делает транспортный пакет
 * (`TransportToken`). Строковое имя выводится из id токена
 * (`transportNameOf`) и продолжает ехать в `Raw`/`EndpointMeta`.
 */
export type TransportRef = TokenString<any>;

/**
 * Имя транспорта из id его токена: часть после последнего `:`.
 *
 * Токены транспортов именуются `transport:http` — префикс отделяет их от
 * пользовательских токенов в графе, а слоям пайплайна нужно то же короткое
 * `'http'`, которое они читали до перехода на токены.
 */
export const transportNameOf = (ref: TransportRef): string => {
  const id = String(ref);
  const separator = id.lastIndexOf(':');

  return separator === -1 ? id : id.slice(separator + 1);
};

/**
 * Symbol-бренд декларации endpoint'а.
 *
 * Ставится неперечислимым свойством: декларация остаётся обычным значением
 * (спред, `Object.keys`, сериализация её не замечают), но дискавери может
 * отличить её от случайно попавшего в `endpoints:` сервиса или конфига.
 */
const ENDPOINT_BRAND = Symbol.for('nestling:endpoint');

/**
 * Резолвер зависимостей декларации: токен (строковый или класс) → инстанс.
 *
 * Под `App` это обёртка над DI-контейнером; в тестах — любая функция.
 */
export type DependencyResolver = (token: InjectionToken) => unknown;

/**
 * Класс-хендлер: конструктор с методом `handle`.
 *
 * Форма подключения DI, а не второй стиль деклараций: `implements` не нужен,
 * сигнатура `handle` сверяется со схемами в точке декларации.
 */
export type HandlerClass<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  E extends AnyFail = never,
> = Constructor<{ handle: HandlerFn<I, O, P, E> }>;

/**
 * Каррированная фабрика хендлера: внешний вызов — один раз на гашении
 * зависимостей, замыкание играет роль инстанса.
 */
export type HandlerFactory<
  D extends InjectionToken[],
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  E extends AnyFail = never,
> = (...deps: UnwrapInjectionTokens<D>) => HandlerFn<I, O, P, E>;

/**
 * Декларация endpoint'а — значение.
 *
 * Создаётся конструктором своего транспорта (`httpEndpoint`, `cliEndpoint`),
 * которые собраны над kernel-примитивом `makeEndpoint`. Значение неизменно:
 * `resolve` возвращает новую декларацию, исходную не трогает.
 *
 * @param I - конфигурация payload (schema, примитив или модификатор)
 * @param O - конфигурация output
 * @param P - выходной тип pipeline (накопленные middleware поля)
 * @param TNeeds - неразрешённые зависимости декларации: токены `deps`,
 * класс-хендлер и классы-юниты пайплайна. `never` ⇔ декларация исполнима,
 * симметрично `Pipeline<TReq, TAcc, TNeeds>`; транспорты принимают только
 * такую.
 */
export interface EndpointDefinition<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  TNeeds = never,
> {
  /** Токен транспорта, обслуживающего ручку (см. {@link TransportRef}) */
  readonly transport: TransportRef;
  readonly pattern: string;

  /**
   * Хендлер запроса.
   *
   * У декларации с неразрешёнными зависимостями (`TNeeds` ≠ `never`) поле
   * заполнено заглушкой, бросающей понятную ошибку: до транспорта такая
   * декларация не доходит — её отсекают типы.
   */
  readonly handle: HandlerFn<I, O, P>;

  /** Schema или модификатор для input */
  readonly input?: I;

  /** Конфигурация выходных данных */
  readonly output?: O;

  /**
   * Pipeline для этого endpoint.
   *
   * Классы-юниты пайплайна попадают в `TNeeds` декларации и гасятся тем же
   * `resolve`, что и `deps`: транспорт получает исполнимый пайплайн.
   */
  readonly pipeline?: Pipeline<AnyInput, P, never>;

  /** Токены зависимостей каррированной фабрики (в порядке объявления) */
  readonly deps?: readonly InjectionToken[];

  /**
   * Объявленные отказы ручки — список определений `defineFail`.
   *
   * В отличие от `binding`, поле **транспорт-нейтрально и интерпретируется
   * ядром**: из него выводится тип отказов хендлера, а транспорт переносит
   * его в `EndpointMeta`, откуда множество читает страж границы.
   */
  readonly errors?: readonly AnyFailDefinition[];

  /**
   * Транспорт-специфичный биндинг декларации — **непрозрачное для ядра**
   * значение, которое кладёт транспортный конструктор (для HTTP это
   * bind-карта «поле → место»).
   *
   * Ядро переносит его на значение и сохраняет при `resolve`, но никогда не
   * интерпретирует: понятий частей HTTP-запроса в `@nestling/pipeline` нет.
   * Типизирует и читает биндинг тот транспорт, который его положил
   * (`httpBindingOf` в `@nestling/transport.http`).
   */
  readonly binding?: unknown;

  /**
   * Документация операции — транспорт- и формат-нейтральная секция.
   *
   * Ядро её **переносит и не интерпретирует**, как `binding`: ни один путь
   * исполнения запроса от `doc` не зависит. Читают её генераторы описаний
   * (`@nestling/openapi` сегодня, AsyncAPI позже), поэтому полей,
   * осмысленных только для одного формата, в ней нет.
   */
  readonly doc?: DeclarationDoc;

  /**
   * Причина, по которой ручка выведена из-под инвариантов сборки
   * (policy-check).
   *
   * Транспорт-нейтральна и интерпретируется ядром: помеченная ручка
   * исключается из проверки **всех** политик приложения, а `App` печатает
   * её на старте и кладёт в отчёт `check()` — opt-out виден, а не спрятан.
   */
  readonly detached?: string;

  /** @internal фантомное поле для вывода типов */
  readonly $needs?: TNeeds;

  /**
   * Гасит зависимости декларации и возвращает **новую** исполнимую
   * декларацию; исходная остаётся неизменной.
   *
   * Резолвер-форма — каноническая: она работает для всех трёх форм
   * `handle` и заодно связывает классы-юниты пайплайна. Позиционная форма
   * (готовые инстансы в порядке `deps`) удобна в тестах, но класс-хендлер и
   * пайплайн с классами-юнитами ей недоступны.
   *
   * Две перегрузки, а не объединённый параметр: формы различаются
   * семантикой и набором доступных случаев, и IDE должна показывать их
   * раздельно.
   */
  resolve(resolver: DependencyResolver): EndpointDefinition<I, O, P, never>;
  /* eslint-disable-next-line @typescript-eslint/unified-signatures */
  resolve(instances: readonly unknown[]): EndpointDefinition<I, O, P, never>;
}

/** Декларация с любыми параметрами — для мест, где они несущественны */
export type AnyEndpointDefinition = EndpointDefinition<any, any, any, any>;

/**
 * Транспорт-нейтральная часть словаря декларации.
 *
 * Транспортные конструкторы добавляют к ней свой словарь (`method`/`path`
 * для HTTP, `command` для CLI) и собирают `transport`/`pattern` сами.
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
   * `ValidateOutputForm` закрывает слот для `multipart` и для
   * тип-меняющего шага item-цепочки: оба конца выходного потока
   * зафиксированы схемой, поэтому `.batch(...)` здесь — ошибка компиляции
   * в точке декларации, а не рантайм-сюрприз.
   */
  output?: O & ValidateOutputForm<O>;

  /**
   * Объявленные отказы: список определений `defineFail`. Из него
   * выводится множество `E` хендлера — вернуть отказ вне списка нельзя.
   *
   * Проверяется в момент создания декларации: не-определение и
   * повторяющийся код — ошибка сразу, а не на сборке приложения.
   */
  errors?: E;

  /**
   * Pipeline для этого endpoint. Классы-юниты допустимы: они попадают в
   * `TNeeds` декларации и гасятся вместе с `deps`.
   */
  pipeline?: Pipeline<AnyInput, P, PN>;

  /**
   * Транспорт-специфичный биндинг. Переносится на значение декларации как
   * есть; ядро в него не заглядывает (см. `EndpointDefinition.binding`).
   */
  binding?: unknown;

  /**
   * Документация операции: `summary`, `description`, `tags`, `deprecated`,
   * успешный статус и `hidden: '<причина>'`.
   *
   * Проверяется в момент создания декларации — неизвестное поле секции,
   * `hidden: true` и статус вне словаря успешных валят объявление, а не
   * сборку приложения.
   *
   * @example
   * ```typescript
   * doc: { summary: 'List users', tags: ['users'], status: 'OK' }
   * ```
   */
  doc?: DeclarationDoc;

  /**
   * Вывод ручки из-под инвариантов сборки — **только с причиной**.
   *
   * Формы `detached: true` не существует: тип — `string`, а рантайм
   * отвергает не-строку и пустую строку в момент создания декларации.
   * Opt-out тотален (ручка выпадает из всех политик) и потому обязан быть
   * читаемым в diff'е, в выводе старта и в отчёте `check()`.
   *
   * @example
   * ```typescript
   * detached: 'liveness-проба балансировщика: до auth не доходит'
   * ```
   */
  detached?: string;
}

// ---------------------------------------------------------------------------
// Рантайм
// ---------------------------------------------------------------------------

type AnyHandler = HandlerFn<any, any, any>;

/** Нормализованная форма хендлера: одна из трёх пользовательских */
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
  deps: readonly InjectionToken[];
  form: HandlerForm;
  /** Хендлер, полученный гашением зависимостей (форма `fn` исполнима сразу) */
  handle?: AnyHandler;
}

/** Имя токена для текстов ошибок */
function describeToken(token: unknown): string {
  if (typeof token === 'string') {
    return token;
  }
  return typeof token === 'function' && token.name ? token.name : String(token);
}

/** Класс-хендлер узнаётся по методу `handle` на прототипе */
function isHandlerClass(value: unknown): value is HandlerClass {
  if (typeof value !== 'function') {
    return false;
  }
  const proto = (value as { prototype?: { handle?: unknown } }).prototype;
  return Boolean(proto) && typeof proto?.handle === 'function';
}

/**
 * Различает три формы `handle`. Класс проверяется первым: у каррированной
 * фабрики (стрелочной функции) прототипа нет, у голого хендлера на
 * прототипе нет `handle`.
 */
function normalizeHandler(
  handle: unknown,
  deps: readonly InjectionToken[] | undefined,
  pattern: string,
): HandlerForm {
  if (isHandlerClass(handle)) {
    return { kind: 'class', ctor: handle };
  }

  if (typeof handle !== 'function') {
    throw new TypeError(
      `Endpoint '${pattern}': 'handle' must be a function, a curried factory ` +
        `with 'deps', or a class with a handle() method.`,
    );
  }

  if (Array.isArray(deps)) {
    return {
      kind: 'factory',
      factory: handle as (...deps: unknown[]) => AnyHandler,
    };
  }

  return { kind: 'fn', fn: handle as AnyHandler };
}

/**
 * Fail-fast списка `errors:` в момент создания декларации.
 *
 * Проверяется ровно то, что проверяемо без сборки приложения: элемент,
 * не созданный `defineFail`, и повторяющийся код. Оба текста называют
 * ручку и проблемное значение — как и остальные проверки словаря.
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
      `${where}: 'errors' must be an array of defineFail() definitions.`,
    );
  }

  const seen = new Set<string>();
  for (const [index, definition] of errors.entries()) {
    if (!isFailDefinition(definition)) {
      throw new TypeError(
        `${where}: errors[${index}] is not a fail definition — ` +
          `expected a value created by defineFail().`,
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
 * Fail-fast пометки `detached` в момент создания декларации.
 *
 * Типы делают `detached: true` невыразимым, но JS-потребителей типы не
 * сдерживают: тихий `detached: true` вывел бы ручку из-под всех политик,
 * не оставив в коде ни строчки о том, почему. Текст называет ручку и
 * требование причины — как остальные проверки словаря.
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

/** Заглушка `handle` для декларации с неразрешёнными зависимостями */
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
 * Материализует зависимости резолвером, требуя непустой результат для
 * каждого токена.
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
 * Связывает классы-юниты пайплайна тем же резолвером, которым гасятся
 * `deps`: транспорт получает исполнимый пайплайн.
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

  // Декларация уже исполнима (голая функция или результат прошлого
  // `resolve`): гасить нечего, остаётся связать классы-юниты пайплайна.
  // Благодаря этому повторный `resolve` не вызывает фабрику второй раз.
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

/** Собирает значение-декларацию: перечислимые поля + неперечислимый бренд */
function buildDefinition(state: EndpointState): AnyEndpointDefinition {
  const definition: Record<string, unknown> = {
    transport: state.transport,
    pattern: state.pattern,
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
  // Непрозрачный носитель: переносится как есть — `resolve` строит новое
  // значение из того же `state`, поэтому карта переживает гашение.
  if (state.binding !== undefined) {
    definition.binding = state.binding;
  }
  // Как и биндинг, переживает гашение зависимостей: `resolve` строит новое
  // значение из того же `state`.
  if (state.errors !== undefined) {
    definition.errors = state.errors;
  }
  // Документация переживает гашение наравне с биндингом и отказами: иначе
  // документ, построенный по погашенным декларациям, отличался бы от
  // построенного по объявленным
  if (state.doc !== undefined) {
    definition.doc = state.doc;
  }
  // Причина opt-out'а переживает гашение по той же причине: интроспекция
  // исполнимой декларации обязана видеть то же, что и исходной
  if (state.detached !== undefined) {
    definition.detached = state.detached;
  }
  if (state.deps.length > 0) {
    definition.deps = state.deps;
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
 * Kernel-примитив деклараций: нормализует три формы `handle`, запоминает
 * `deps`, переносит транспорт-нейтральные `errors:`, `doc` и `detached`,
 * ставит бренд и выдаёт `resolve`.
 *
 * В пользовательский канон не входит — там per-transport конструкторы
 * (`httpEndpoint`, `cliEndpoint`), которые являются тонкими надстройками
 * над ним и добавляют только свой словарь.
 *
 * @example
 * ```typescript
 * const Ping = makeEndpoint({
 *   transport: HttpTransport$,          // токен транспорта, не строка
 *   pattern: 'GET /ping',
 *   output: PingOutput,
 *   pipeline: basePipeline,
 *   handle: async () => Ok.of({ pong: true }),
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
    deps?: undefined;
    handle: HandlerFn<I, O, P, FailsOf<E>>;
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
    deps: [...D];
    handle: HandlerFactory<D, I, O, P, FailsOf<E>>;
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
    deps?: undefined;
    handle: C;
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
    deps?: InjectionToken[];
    handle: unknown;
  },
): AnyEndpointDefinition {
  const form = normalizeHandler(options.handle, options.deps, options.pattern);
  assertFailDefinitions(options.errors, options.pattern);
  assertDetached(options.detached, options.pattern);
  // Правило словаря `doc` одно на декларацию и на контракт — реализация
  // общая, различается только адресат жалобы
  assertDoc(options.doc, `Endpoint '${options.pattern}'`);
  // Формы io проверяются здесь, а не в транспортных конструкторах: правило
  // транспорт-нейтрально, и kernel-примитив обязан быть под той же
  // гарантией, что `httpEndpoint`/`cliEndpoint`
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
    deps: options.deps ?? [],
    form,
    // Голая функция исполнима сразу; остальные формы ждут resolve()
    handle: form.kind === 'fn' ? form.fn : undefined,
  };

  return buildDefinition(state);
}
