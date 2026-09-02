/**
 * Правило размещения полей HTTP-input и bind-карта.
 *
 * Место каждого поля `input` в HTTP-запросе определяют шаблон пути, метод и
 * пометки `bind`. Результат вычисляется при создании декларации или
 * операции и хранится на значении в виде карты `HttpBinding`. Карту читают
 * транспорт (сборка payload), генератор OpenAPI (`parameter` или
 * `requestBody`) и типизированный клиент (сборка запроса).
 *
 * Правило живёт в этом пакете, а не в транспорте, потому что карту должен
 * получать клиент, который импортирует операция без серверного кода.
 *
 * Карта не перечисляет все поля: Standard Schema не даёт списка ключей в
 * рантайме. Вместо этого у каждого поля есть место: явное в `fields`
 * (path-параметры и пометки) или общее `rest`.
 */

import { describeForm, isPrimitiveLeaf } from '../io/forms.js';
import type { BindableFields } from '../io/io.js';

/**
 * HTTP-метод: методы HTTP/1.1.
 *
 * Тип объявлен здесь, а не взят из маршрутизатора транспорта, потому что
 * карту читает и браузерный клиент. Методы WebDAV операция не адресует;
 * маршрутизатор транспорта принимает свой, более широкий тип.
 */
export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'TRACE';

/**
 * Настройки SSE-ответа: поля `id` и `event` кадра, период heartbeat.
 *
 * Объявлены рядом с картой, а не в транспорте: секция хранится на том же
 * значении, что и размещение полей, и проверяется при его создании.
 */
export interface SseConfig<T = any> {
  /** Значение поля `id:` кадра; не задано — поле не пишется */
  id?: (item: T) => string | number;

  /** Имя события; не задано — поле не пишется. `error` зарезервировано */
  event?: (item: T) => string;

  /** Период heartbeat-комментариев; не задан — опция транспорта */
  heartbeat?: number;
}

/** Часть HTTP-запроса, в которой живёт поле payload */
export type BindPlace = 'path' | 'query' | 'body';

/** Размещение одного поля */
export interface BindPlacement {
  readonly in: BindPlace;

  /** Query-поле всегда массив, даже при одном вхождении ключа */
  readonly multiple?: boolean;
}

/**
 * Bind-карта: явные размещения полей и правило для остальных.
 */
export interface HttpBinding {
  readonly method: HttpMethod;

  /** Шаблон пути с `:param`-сегментами */
  readonly path: string;

  /** Явные размещения: path-параметры шаблона и помеченные поля */
  readonly fields: Readonly<Record<string, BindPlacement>>;

  /** Куда попадают все остальные поля */
  readonly rest: 'query' | 'body';

  /** Запрошены ли сырые байты тела в стартовом контексте */
  readonly rawBody: boolean;

  /**
   * Имя операции, которому принадлежит адрес. Есть только у карты,
   * построенной `makeRequest`.
   *
   * Хранится на карте, потому что декларация `httpEndpoint({ contract })`
   * получает ту же карту, не пересчитывая её, и другого пути передать ей
   * имя операции нет. Имя читает генератор документации: из него
   * выводится `operationId`.
   */
  readonly contract?: string;

  /**
   * Настройки SSE. Хранятся на карте вместе с размещением полей; ядро их
   * не читает.
   */
  readonly sse?: SseConfig;
}

/**
 * Пометка размещения поля: значение, созданное `query()` или `body()`.
 *
 * Строковая форма (`bind: { expand: 'query' }`) не принимается: у пометок
 * есть опции (`query({ multiple: true })`), и одна форма записи проще
 * двух.
 */
export interface BindMark {
  /** @internal Дискриминант пометки */
  readonly __bind: 'http';

  readonly in: Exclude<BindPlace, 'path'>;

  readonly multiple?: boolean;
}

/**
 * Методы без тела запроса. По этой константе вычисляется `rest` и
 * отвергается `body()`.
 */
export const METHODS_WITHOUT_BODY: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'DELETE',
  'OPTIONS',
  'TRACE',
]);

/**
 * Пометка «поле приходит в query-строке».
 *
 * @param options.multiple - Поле всегда массив, даже при одном вхождении
 * ключа (`?tag=a` даёт `['a']`)
 *
 * @example
 * ```typescript
 * bind: { expand: query(), tags: query({ multiple: true }) }
 * ```
 */
export function query(options?: { multiple?: boolean }): BindMark {
  return options?.multiple === true
    ? { __bind: 'http', in: 'query', multiple: true }
    : { __bind: 'http', in: 'query' };
}

/**
 * Пометка «поле приходит в теле запроса». У методов без тела отвергается
 * при создании декларации.
 */
export function body(): BindMark {
  return { __bind: 'http', in: 'body' };
}

/** Проверяет, что значение создано `query()` или `body()` */
export function isBindMark(value: unknown): value is BindMark {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as BindMark).__bind === 'http'
  );
}

/**
 * Имена path-параметров шаблона (`:param`-сегментов) на уровне типов.
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
 * Ключи, которые можно пометить в `bind`: поля схемы `input` без
 * path-параметров шаблона.
 *
 * Рантайм не знает ключей Standard Schema, а типы знают. Поэтому опечатка в
 * имени поля и пометка на path-параметре — ошибки компиляции. Если ключи
 * `input` не выводятся (`AnyPayload`), тип допускает любые строки, и
 * правила проверяет рантайм.
 *
 * Тип общий для `httpEndpoint` и секции `http` операции.
 */
export type BindMap<Path extends string, I> = [
  Extract<keyof BindableFields<I>, string>,
] extends [never]
  ? Readonly<Record<string, BindMark>>
  : Partial<
      Readonly<
        Record<
          Exclude<Extract<keyof BindableFields<I>, string>, PathParams<Path>>,
          BindMark
        >
      >
    >;

/**
 * Возвращает имена path-параметров шаблона в порядке следования.
 */
export function readPathParams(path: string): string[] {
  return path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

/**
 * Проверяет шаблон пути: непустой, начинается с `/`, path-параметры не
 * повторяются.
 *
 * Совпадение path-параметра с полем схемы не проверяется: Standard Schema
 * не даёт списка ключей. Правила размещения (пометки, `rawBody`,
 * неструктурный `input`) проверяет `computeHttpBinding`.
 *
 * @param where - Как назвать владельца в тексте ошибки
 */
export function assertHttpPath(
  path: unknown,
  where: string,
): asserts path is string {
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

/** Аргументы вычисления bind-карты */
export interface ComputeHttpBindingOptions {
  method: string;

  /** Шаблон пути с `:param`-сегментами */
  path: string;

  /** Пометки размещения полей */
  bind?: Readonly<Record<string, BindMark>>;

  /** Передавать сырые байты тела в контекст */
  rawBody?: boolean;

  /**
   * Форма `input`. Нужна только для проверок: у потоковой и примитивной
   * форм payload не объект, и path-параметры с пометками в него не
   * поместить.
   */
  input?: unknown;

  /** Форма `output`; нужна для проверки секции `sse` */
  output?: unknown;

  /** Секция `sse` */
  sse?: SseConfig;

  /**
   * Имя операции, которому принадлежит адрес. Задаёт только
   * `makeRequest`.
   */
  contract?: string;

  /**
   * Как назвать владельца в тексте ошибки: `Operation '<имя>'` для
   * операции. Если не задано, используются метод и путь.
   */
  where?: string;
}

/** Форма `input` с точки зрения размещения полей */
type InputShape = 'absent' | 'structured' | 'unstructured';

/** Бренд карты; по нему `isHttpBinding` отличает карту от постороннего объекта */
const HTTP_BINDING = Symbol.for('nestling:http:binding');

/** Имя владельца для текста ошибки, если `where` не задан */
function whereOf(options: ComputeHttpBindingOptions): string {
  return (
    options.where ??
    `HTTP binding ({ method: '${options.method}', path: '${options.path}' })`
  );
}

/**
 * Определяет форму `input` с точки зрения размещения полей.
 *
 * `multipart` структурна: path-параметры и query-поля добавляются к полям
 * формы (`fields`) до валидации. Потоковые и примитивные формы
 * неструктурны: payload не объект.
 */
function describeInput(input: unknown): {
  shape: InputShape;
  kind: string;
} {
  const form = describeForm(input);

  switch (form.kind) {
    case 'multipart': {
      return { shape: 'structured', kind: 'multipart(...)' };
    }
    case 'stream': {
      return { shape: 'unstructured', kind: 'stream(...)' };
    }
    case 'events': {
      return { shape: 'unstructured', kind: 'events(...)' };
    }
    default: {
      if (form.leaf === undefined) {
        return { shape: 'absent', kind: 'none' };
      }
      return isPrimitiveLeaf(form.leaf)
        ? { shape: 'unstructured', kind: `'${form.leaf}'` }
        : { shape: 'structured', kind: 'schema' };
    }
  }
}

/**
 * Проверяет пометки и path-параметры: всё, что можно проверить без списка
 * ключей схемы.
 *
 * Совпадение path-параметра с полем схемы не проверяется (Standard Schema
 * не даёт списка ключей). Проверяются случаи, когда для параметра или
 * помеченного поля нет места в payload.
 */
function assertBindable(options: ComputeHttpBindingOptions): void {
  const { method, path, bind, rawBody = false, input } = options;
  const where = whereOf(options);

  const pathParams = readPathParams(path);
  const marks = Object.entries(bind ?? {});
  const { shape, kind } = describeInput(input);
  const bodyless = METHODS_WITHOUT_BODY.has(method.toUpperCase());

  for (const [name, mark] of marks) {
    if (!isBindMark(mark)) {
      throw new TypeError(
        `${where}: 'bind.${name}' must be a mark created by query() or ` +
          `body(); the string form is not accepted.`,
      );
    }

    if (pathParams.includes(name)) {
      throw new Error(
        `${where}: field '${name}' is the path parameter ':${name}' and ` +
          `cannot be re-bound — drop it from 'bind'.`,
      );
    }

    if (mark.in === 'body' && bodyless) {
      throw new Error(
        `${where}: field '${name}' is bound to the body, but '${method}' ` +
          `has no request body.`,
      );
    }
  }

  if (marks.length > 0 && shape === 'unstructured') {
    throw new Error(
      `${where}: 'bind' is not applicable to a non-structural input ` +
        `(${kind}) — there is no payload object to place fields into.`,
    );
  }

  if (pathParams.length > 0 && shape !== 'structured') {
    const [name] = pathParams;
    throw new Error(
      shape === 'absent'
        ? `${where}: path parameter ':${name}' has nowhere to go — the ` +
          `declaration has no 'input'.`
        : `${where}: path parameter ':${name}' has nowhere to go — 'input' ` +
          `is non-structural (${kind}).`,
    );
  }

  if (rawBody && (shape === 'unstructured' || kind === 'multipart(...)')) {
    throw new Error(
      `${where}: 'rawBody: true' is not compatible with ${kind} input — ` +
        `the request body is consumed by the parser.`,
    );
  }
}

/**
 * Пробное значение для `sse.event`: элемента при создании декларации ещё
 * нет.
 *
 * Отдельная константа, потому что литерал `undefined` в аргументе удаляет
 * автофиксер ESLint.
 */
const NO_ITEM = undefined as never;

/**
 * Проверяет секцию `sse`: выход должен быть `events(...)`, имя события не
 * может быть `error` (оно зарезервировано за отказом посреди потока).
 *
 * Функцию `sse.event` нельзя проверить в общем виде: имя зависит от
 * элемента. Поэтому она вызывается с `undefined`: константная функция
 * вернёт имя, а функция вида `e => e.kind` бросит исключение, которое
 * здесь игнорируется. Окончательно имя проверяется при сборке кадра.
 */
function assertSse(options: ComputeHttpBindingOptions): void {
  const { sse, output } = options;
  if (!sse) {
    return;
  }

  const where = whereOf(options);

  if (describeForm(output).kind !== 'events') {
    throw new Error(
      `${where}: 'sse' is only meaningful for an events(...) output — the ` +
        `section describes SSE frames.`,
    );
  }

  if (sse.event) {
    let probed: unknown;
    try {
      probed = sse.event(NO_ITEM);
    } catch {
      // Имя зависит от элемента; на пробном значении исключение ожидаемо
      return;
    }

    if (probed === 'error') {
      throw new Error(
        `${where}: SSE event name 'error' is reserved for mid-stream ` +
          `failures — pick another name in 'sse.event'.`,
      );
    }
  }
}

/**
 * Собирает bind-карту без проверок.
 *
 * Экспортируется для одного потребителя: транспорт строит карту для
 * декларации, созданной `makeEndpoint` без неё. Проверки там не нужны: они
 * относятся к конструктору декларации, а на пути приёма запроса карта
 * определяется методом и путём.
 */
export function buildHttpBinding(
  options: ComputeHttpBindingOptions,
): HttpBinding {
  const { method, path, bind, rawBody = false, sse, contract } = options;

  const fields: Record<string, BindPlacement> = {};

  // Сначала path-параметры шаблона; пометка на них отвергнута в assertBindable
  for (const name of readPathParams(path)) {
    fields[name] = Object.freeze({ in: 'path' as const });
  }

  for (const [name, mark] of Object.entries(bind ?? {})) {
    fields[name] = Object.freeze(
      mark.multiple === true
        ? { in: mark.in, multiple: true }
        : { in: mark.in },
    );
  }

  const binding: HttpBinding = {
    method: method.toUpperCase() as HttpMethod,
    path,
    fields: Object.freeze(fields),
    rest: METHODS_WITHOUT_BODY.has(method.toUpperCase()) ? 'query' : 'body',
    rawBody: Boolean(rawBody),
    ...(sse === undefined ? {} : { sse: Object.freeze({ ...sse }) }),
    ...(contract === undefined ? {} : { contract }),
  };

  Object.defineProperty(binding, HTTP_BINDING, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(binding);
}

/**
 * Проверяет аргументы и собирает bind-карту.
 *
 * Вызывается при создании декларации (`httpEndpoint`) или операции
 * (`makeRequest`), а не при регистрации в приложении: карта нужна
 * клиенту без серверного кода, а ошибку должен увидеть владелец
 * декларации.
 *
 * @throws {Error} Нарушение правила размещения (см. `assertBindable`) или
 * секции `sse` (см. `assertSse`)
 */
export function computeHttpBinding(
  options: ComputeHttpBindingOptions,
): HttpBinding {
  assertBindable(options);
  assertSse(options);
  return buildHttpBinding(options);
}

/** Проверяет, что значение — bind-карта, созданная этим модулем */
export function isHttpBinding(value: unknown): value is HttpBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[HTTP_BINDING] === true
  );
}
