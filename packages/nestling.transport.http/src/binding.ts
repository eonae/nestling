/**
 * Серверная половина bind-карты: разбор запроса по ней.
 *
 * Пометки `query()` и `body()`, тип карты и её вычисление
 * (`computeHttpBinding`) живут в `@nestling/operations`, чтобы клиент
 * получал карту вместе с операцией без серверного кода. Здесь — разбор
 * query-строки, сборка payload из канонических мест и чтение карты с
 * декларации. Пометки и тип карты реэкспортированы для авторов
 * HTTP-деклараций.
 */

import type { BindPlacement, HttpBinding } from '@nestling/operations';
import { buildHttpBinding, isHttpBinding } from '@nestling/operations';

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
} from '@nestling/operations';
export type {
  BindMap,
  BindMark,
  BindPlace,
  BindPlacement,
  ComputeHttpBindingOptions,
  HttpBinding,
  HttpMethod,
  PathParams,
} from '@nestling/operations';

/**
 * Разбирает query-строку, сохраняя все вхождения ключа.
 *
 * Одно вхождение — скаляр, два и более — массив в порядке следования; поле,
 * помеченное `query({ multiple: true })`, приходит массивом и при одном
 * вхождении. Ноль вхождений — поля нет: отсутствие остаётся отсутствием,
 * чтобы `.optional()` и дефолты схемы работали.
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

  /** Тело или поля формы `multipart`; `undefined`, если тело не читалось */
  body?: unknown;

  /** Path-параметры из совпадения с маршрутом */
  params: Record<string, string>;

  /**
   * Источник «остальное». Обычно `binding.rest`; для `multipart` всегда
   * `'body'`.
   */
  rest?: 'query' | 'body';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Собирает payload из канонических мест.
 *
 * ```
 * payload = { ...restSource, ...markedFields, ...pathParams }
 * ```
 *
 * Приоритет: путь, затем пометка, затем источник «остальное». Поле,
 * присланное не в своё место, в payload не попадает и проваливает обычную
 * валидацию.
 */
export function assemblePayload(
  binding: HttpBinding,
  sources: PayloadSources,
): unknown {
  const { query: queryValues, body: bodyValue, params } = sources;
  const rest = sources.rest ?? binding.rest;
  const restSource = rest === 'query' ? queryValues : bodyValue;

  // Без явных размещений payload — это источник «остальное» целиком.
  // Тело может быть и не объектом (массив, строка): оно уходит хендлеру
  // как есть
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
 * клиент — с декларации; всем нужны одни и те же два поля.
 */
export interface BindingBearer {
  readonly pattern: string;
  readonly binding?: unknown;
}

/**
 * Читает bind-карту с декларации.
 *
 * Декларация из `makeEndpoint` карты не несёт: тогда карта вычисляется из
 * `pattern` (метод и шаблон) без пометок.
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
