/**
 * Канон размещения HTTP-input и bind-карта.
 *
 * Куда каждое поле `input` кладётся в HTTP-запросе — детерминированная
 * функция `(шаблон пути, метод, пометки) → место`. Результат материализуется
 * **при создании декларации** в плоскую карту `HttpBinding`, которая едет на
 * значении декларации и одинаково читается тремя потребителями: транспортом
 * (сборка payload), генератором OpenAPI (`parameter` vs `requestBody`) и
 * типизированным клиентом (сборка запроса из одного импорта, без сервера).
 *
 * Карта не перечисляет все поля — перечня ключей у Standard Schema в рантайме
 * нет. Она **тотальна как правило**: у каждого поля есть место — либо явное в
 * `fields` (path-параметры и пометки), либо `rest`.
 */

import type { AnyEndpointDefinition } from '@nestling/pipeline';
import { analyzePayload } from '@nestling/pipeline';
import type { HTTPMethod } from 'find-my-way';

/** Часть HTTP-запроса, в которой живёт поле payload */
export type BindPlace = 'path' | 'query' | 'body';

/** Размещение одного поля */
export interface BindPlacement {
  readonly in: BindPlace;

  /** query-поле всегда массив — в том числе при одном вхождении ключа */
  readonly multiple?: boolean;
}

/**
 * Плоская bind-карта декларации: явные размещения плюс правило для
 * остального.
 */
export interface HttpBinding {
  readonly method: HTTPMethod;

  /** Шаблон пути с `:param`-сегментами */
  readonly path: string;

  /** Явные размещения: path-параметры шаблона и помеченные поля */
  readonly fields: Readonly<Record<string, BindPlacement>>;

  /** Куда попадают все остальные поля */
  readonly rest: 'query' | 'body';

  /** Запрошены ли сырые байты тела в стартовом контексте */
  readonly rawBody: boolean;
}

/**
 * Пометка размещения — **значение**, а не строка.
 *
 * Строковая форма (`bind: { expand: 'query' }`) не принимается намеренно:
 * `query({ multiple: true })` требует опций, а `header('If-Match')` (когда
 * вернётся из deferred) — аргумента. Одна форма записи на все случаи вместо
 * двух; носитель (карта) от формы сахара не зависит.
 */
export interface BindMark {
  /** @internal дискриминант марки: строковая форма записи не принимается */
  readonly __bind: 'http';

  readonly in: Exclude<BindPlace, 'path'>;

  readonly multiple?: boolean;
}

/**
 * Методы без тела запроса.
 *
 * Одна константа обслуживает и правило `rest`, и fail-fast для `body()`:
 * разъехаться им негде.
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
 * @param options.multiple - поле всегда массив, в том числе при одном
 * вхождении ключа (`?tag=a` → `['a']`)
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
 * Пометка «поле приходит в теле запроса».
 *
 * Осмысленна для методов без тела она быть не может — такая декларация
 * отвергается при создании.
 */
export function body(): BindMark {
  return { __bind: 'http', in: 'body' };
}

/** Значение создано `query()`/`body()`, а не написано строкой */
export function isBindMark(value: unknown): value is BindMark {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as BindMark).__bind === 'http'
  );
}

/**
 * Разбирает шаблон пути в список имён path-параметров (в порядке следования).
 */
export function readPathParams(path: string): string[] {
  return path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

/** Опции разворачивания канона в карту */
export interface ComputeHttpBindingOptions {
  method: string;

  /** Шаблон пути с `:param`-сегментами */
  path: string;

  /** Пометки «поле → место» из словаря декларации */
  bind?: Readonly<Record<string, BindMark>>;

  /** Сырые байты тела в стартовом контексте */
  rawBody?: boolean;

  /**
   * Конфигурация `input` — нужна только для fail-fast: у потоковой,
   * файловой и примитивной форм payload не объект, и класть в него
   * path-параметры и помеченные поля некуда.
   */
  input?: unknown;
}

/** Форма `input` с точки зрения размещения полей */
type InputShape = 'absent' | 'structured' | 'unstructured';

/** Бренд карты: отличает нашу карту от постороннего значения в `binding` */
const HTTP_BINDING = Symbol.for('nestling:http:binding');

function describeInput(input: unknown): {
  shape: InputShape;
  kind: string;
} {
  if (input === undefined) {
    return { shape: 'absent', kind: 'none' };
  }

  const config = analyzePayload(input);

  switch (config.type) {
    case 'schema': {
      return config.schema === undefined
        ? { shape: 'absent', kind: 'none' }
        : { shape: 'structured', kind: 'schema' };
    }
    case 'withFiles': {
      return { shape: 'structured', kind: 'withFiles(...)' };
    }
    case 'stream': {
      return { shape: 'unstructured', kind: 'stream(...)' };
    }
    case 'files': {
      return { shape: 'unstructured', kind: 'files()' };
    }
    default: {
      return { shape: 'unstructured', kind: `'${config.primitive}'` };
    }
  }
}

/**
 * Fail-fast словаря: ровно то, что решаемо без интроспекции схемы.
 *
 * Проверка «path-параметр объявлен в шаблоне, но поля с таким именем в схеме
 * нет» в общем виде недостижима — Standard Schema перечня ключей не отдаёт.
 * Реализуется её решаемая часть: случаи, когда параметру или помеченному
 * полю физически негде оказаться.
 */
function assertBindable(options: ComputeHttpBindingOptions): void {
  const { method, path, bind, rawBody = false, input } = options;
  const where = `httpEndpoint({ method: '${method}', path: '${path}' })`;

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

  if (rawBody && (shape === 'unstructured' || kind === 'withFiles(...)')) {
    throw new Error(
      `${where}: 'rawBody: true' is not compatible with ${kind} input — ` +
        `the request body is consumed by the parser.`,
    );
  }
}

/** Собирает карту без проверок (канон полностью определён аргументами) */
function buildBinding(options: ComputeHttpBindingOptions): HttpBinding {
  const { method, path, bind, rawBody = false } = options;

  const fields: Record<string, BindPlacement> = {};

  // Path-параметры шаблона — первыми: пометка на них отвергнута выше
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
    method: method.toUpperCase() as HTTPMethod,
    path,
    fields: Object.freeze(fields),
    rest: METHODS_WITHOUT_BODY.has(method.toUpperCase()) ? 'query' : 'body',
    rawBody: Boolean(rawBody),
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
 * Разворачивает канон и пометки в плоскую bind-карту.
 *
 * Вызывается конструктором декларации (`httpEndpoint`) в момент создания
 * значения — не при регистрации в приложении: карту обязан получать клиент,
 * импортирующий контракт без серверного кода, а fail-fast обязан срабатывать
 * у владельца декларации.
 *
 * @throws {Error} Нарушение правила размещения (см. `assertBindable`)
 */
export function computeHttpBinding(
  options: ComputeHttpBindingOptions,
): HttpBinding {
  assertBindable(options);
  return buildBinding(options);
}

/** Значение — bind-карта, положенная этим транспортом */
export function isHttpBinding(value: unknown): value is HttpBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[HTTP_BINDING] === true
  );
}

/**
 * Разбирает query-строку, сохраняя все вхождения ключа.
 *
 * Одно вхождение — скаляр, два и более — массив в порядке следования; поле,
 * помеченное `query({ multiple: true })`, приходит массивом и при одном
 * вхождении. Ноль вхождений — поля нет: отсутствие остаётся отсутствием,
 * чтобы `.optional()` и дефолты схемы работали.
 *
 * Молчаливого last-wins (`searchParams.entries()` в плоский объект) больше
 * не существует.
 */
export function readQuery(
  search: URLSearchParams,
  fields: Readonly<Record<string, BindPlacement>> = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of new Set(search.keys())) {
    const values = search.getAll(key);
    const multiple = fields[key]?.multiple === true;
    result[key] = multiple || values.length > 1 ? values : values[0];
  }

  return result;
}

/** Источники, из которых транспорт собирает payload по карте */
export interface PayloadSources {
  /** Разобранная query-строка */
  query: Record<string, unknown>;

  /** Разобранное тело (или поля формы для `withFiles`); не читалось — `undefined` */
  body?: unknown;

  /** Path-параметры из совпадения с маршрутом */
  params: Record<string, string>;

  /**
   * Источник «остальное». Обычно `binding.rest`; для `withFiles` всегда
   * `'body'` — эта форма body-ориентирована по построению.
   */
  rest?: 'query' | 'body';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Собирает payload **только из канонических мест**.
 *
 * ```
 * payload = { ...restSource, ...markedFields, ...pathParams }
 * ```
 *
 * Приоритет фиксирован (path > пометка > rest) и в конфликт не превращается:
 * поле, присланное не в своё место, в payload просто не попадает и
 * проваливает обычную валидацию. Слияния «отовсюду» нет.
 */
export function assemblePayload(
  binding: HttpBinding,
  sources: PayloadSources,
): unknown {
  const { query: queryValues, body: bodyValue, params } = sources;
  const rest = sources.rest ?? binding.rest;
  const restSource = rest === 'query' ? queryValues : bodyValue;

  // Ничего не размещено явно — payload и есть источник «остальное».
  // Тело при этом может быть и не объектом (массив, строка): такой input
  // уезжает хендлеру как есть.
  if (Object.keys(binding.fields).length === 0) {
    return restSource ?? {};
  }

  const payload: Record<string, unknown> = {};

  const restRecord = asRecord(restSource);
  for (const key of Object.keys(restRecord)) {
    if (!(key in binding.fields)) {
      payload[key] = restRecord[key];
    }
  }

  for (const [name, placement] of Object.entries(binding.fields)) {
    if (placement.in === 'path') {
      continue;
    }
    const source = placement.in === 'query' ? queryValues : asRecord(bodyValue);
    if (Object.hasOwn(source, name)) {
      payload[name] = source[name];
    }
  }

  for (const [name, value] of Object.entries(params)) {
    payload[name] = value;
  }

  return payload;
}

/** Требуется ли читать тело запроса по этой карте */
export function bindingNeedsBody(binding: HttpBinding): boolean {
  return (
    binding.rest === 'body' ||
    Object.values(binding.fields).some((placement) => placement.in === 'body')
  );
}

/**
 * Читает bind-карту с декларации.
 *
 * Декларация, созданная kernel-примитивом `makeEndpoint`, карты не несёт —
 * тогда считается **тот же канон** без пометок из `pattern` (метод и шаблон
 * в нём уже есть). Fail-fast здесь неуместен: канон полностью определён
 * парой (метод, путь), и запрещать kernel-примитив ради церемонии незачем.
 */
export function httpBindingOf(definition: AnyEndpointDefinition): HttpBinding {
  const carried: unknown = definition.binding;
  if (isHttpBinding(carried)) {
    return carried;
  }

  const separator = definition.pattern.indexOf(' ');
  const method =
    separator > 0 ? definition.pattern.slice(0, separator) : definition.pattern;
  const path =
    separator > 0 ? definition.pattern.slice(separator + 1).trim() || '/' : '/';

  return buildBinding({ method, path });
}
