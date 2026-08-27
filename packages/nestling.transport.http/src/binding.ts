/**
 * Потребляющая половина bind-карты: приём запроса по ней.
 *
 * Декларативная половина — пометки `query()`/`body()`, тип карты и
 * разворачивание канона (`computeHttpBinding`) — живёт в
 * `@nestling/contracts`: карту обязан получать клиент, импортирующий
 * контракт без серверного кода. Здесь остаётся то, что имеет смысл только
 * на сервере: разбор query-строки, strict-сборка payload из канонических
 * мест и чтение карты с декларации.
 *
 * Пометки и тип карты реэкспортируются: автор HTTP-декларации берёт их
 * оттуда же, откуда `httpEndpoint`.
 */

import type { BindPlacement, HttpBinding } from '@nestling/contracts';
import { buildHttpBinding, isHttpBinding } from '@nestling/contracts';

export {
  assertHttpPath,
  body,
  buildHttpBinding,
  computeHttpBinding,
  isBindMark,
  isHttpBinding,
  METHODS_WITHOUT_BODY,
  query,
  readPathParams,
} from '@nestling/contracts';
export type {
  BindMap,
  BindMark,
  BindPlace,
  BindPlacement,
  ComputeHttpBindingOptions,
  HttpBinding,
  HttpMethod,
  PathParams,
} from '@nestling/contracts';

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

  /** Разобранное тело (или поля формы для `multipart`); не читалось — `undefined` */
  body?: unknown;

  /** Path-параметры из совпадения с маршрутом */
  params: Record<string, string>;

  /**
   * Источник «остальное». Обычно `binding.rest`; для `multipart` всегда
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
 * Носитель карты: декларация или её проекция для транспорта.
 *
 * Транспорт читает карту с `RouteDeclaration`, `@nestling/openapi` и
 * клиент — с самой декларации; структурно им нужны одни и те же два поля.
 */
export interface BindingBearer {
  readonly pattern: string;
  readonly binding?: unknown;
}

/**
 * Читает bind-карту с декларации.
 *
 * Декларация, созданная kernel-примитивом `makeEndpoint`, карты не несёт —
 * тогда считается **тот же канон** без пометок из `pattern` (метод и шаблон
 * в нём уже есть). Fail-fast здесь неуместен: канон полностью определён
 * парой (метод, путь), и запрещать kernel-примитив ради церемонии незачем.
 */
export function httpBindingOf(definition: BindingBearer): HttpBinding {
  const carried: unknown = definition.binding;
  if (isHttpBinding(carried)) {
    return carried;
  }

  const separator = definition.pattern.indexOf(' ');
  const method =
    separator > 0 ? definition.pattern.slice(0, separator) : definition.pattern;
  const path =
    separator > 0 ? definition.pattern.slice(separator + 1).trim() || '/' : '/';

  return buildHttpBinding({ method, path });
}
