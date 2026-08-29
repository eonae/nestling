/**
 * Сборка запроса по bind-карте — операция, **обратная** strict-приёму
 * транспорта.
 *
 * Карта общая для клиента и сервера: сервер по ней раскладывает запрос в
 * payload, клиент по ней же собирает payload в запрос. Инвариант, который
 * обязан держаться и проверяется round-trip-тестом:
 * `assemblePayload(binding, split(binding, payload)) ≡ payload`.
 */

import type { HttpBinding } from '@nestling/contracts';

/** Что уходит в сеть */
export interface BuiltRequest {
  /** Полный URL с подставленными path-параметрами и query-строкой */
  url: string;

  method: string;

  /** Сериализованное тело; `undefined` — тела нет */
  body?: string;
}

/** Скаляр, представимый в query-строке как есть */
function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Записывает поле в query-строку по правилам коерсии.
 *
 * Правила закрыты и не догадываются:
 * - `undefined`/`null` — ключ не пишется вовсе (отсутствие остаётся
 *   отсутствием, и `.optional()`/дефолты схемы продолжают работать);
 * - скаляр — `String(value)`;
 * - массив скаляров — повторяющиеся вхождения ключа в порядке следования
 *   (симметрия с `readQuery`, который сохраняет все вхождения);
 * - что угодно ещё — `TypeError` в момент вызова. Молчаливый
 *   `[object Object]` в запросе хуже падения: сервер отверг бы его
 *   валидацией, но уже после похода в сеть и с непонятным сообщением.
 */
function writeQueryField(
  search: URLSearchParams,
  name: string,
  value: unknown,
  where: string,
): void {
  if (value === undefined || value === null) {
    return;
  }

  if (isScalar(value)) {
    search.append(name, String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isScalar(item)) {
        throw new TypeError(
          `${where}: query field '${name}' contains a value that has no wire ` +
            `representation (${describeValue(item)}). Query carries scalars ` +
            `and arrays of scalars; move structured data to the body.`,
        );
      }
      search.append(name, String(item));
    }
    return;
  }

  throw new TypeError(
    `${where}: query field '${name}' has no wire representation ` +
      `(${describeValue(value)}). Query carries scalars and arrays of ` +
      `scalars; move structured data to the body.`,
  );
}

/** Короткое описание значения для текста ошибки */
function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'a nested array' : `a ${typeof value}`;
}

/** Payload как запись; не запись — значит явных размещений быть не может */
function asRecord(payload: unknown): Record<string, unknown> | undefined {
  return typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : undefined;
}

/** Склейка адреса сервиса и шаблона пути — буквальная */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * Раскладывает payload по карте и собирает запрос.
 *
 * @param where - как назвать метод клиента в тексте ошибки
 * @throws {TypeError} Значение query-поля нельзя записать в query-строку,
 * или path-параметр отсутствует в payload
 */
export function buildRequest(
  binding: HttpBinding,
  baseUrl: string,
  payload: unknown,
  where: string,
): BuiltRequest {
  const search = new URLSearchParams();
  const record = asRecord(payload);
  const bodyFields: Record<string, unknown> = {};
  const pathValues: Record<string, string> = {};

  let restBody: unknown;
  let hasExplicitBody = false;

  const hasFields = Object.keys(binding.fields).length > 0;

  if (!hasFields) {
    // Зеркало `assemblePayload`: явных размещений нет — payload целиком и
    // есть источник «остальное». Тело при этом может быть и не объектом.
    if (binding.rest === 'query') {
      for (const [name, value] of Object.entries(record ?? {})) {
        writeQueryField(search, name, value, where);
      }
    } else if (payload !== undefined) {
      restBody = payload;
      hasExplicitBody = true;
    }
  } else {
    for (const [name, value] of Object.entries(record ?? {})) {
      const placement = binding.fields[name];

      if (!placement) {
        if (binding.rest === 'query') {
          writeQueryField(search, name, value, where);
        } else {
          bodyFields[name] = value;
          hasExplicitBody = true;
        }
        continue;
      }

      if (placement.in === 'path') {
        if (value === undefined || value === null) {
          throw new TypeError(
            `${where}: path parameter ':${name}' is required by ` +
              `'${binding.path}' but the payload has no value for it.`,
          );
        }
        pathValues[name] = encodeURIComponent(String(value));
        continue;
      }

      if (placement.in === 'query') {
        writeQueryField(search, name, value, where);
        continue;
      }

      bodyFields[name] = value;
      hasExplicitBody = true;
    }

    // Path-параметр, не пришедший в payload вовсе: шаблон остался бы с
    // ':name' в пути, и запрос ушёл бы не туда
    for (const [name, placement] of Object.entries(binding.fields)) {
      if (placement.in === 'path' && pathValues[name] === undefined) {
        throw new TypeError(
          `${where}: path parameter ':${name}' is required by ` +
            `'${binding.path}' but the payload has no value for it.`,
        );
      }
    }
  }

  const path = binding.path
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? pathValues[segment.slice(1)] : segment,
    )
    .join('/');

  const query = search.toString();
  const url = `${joinUrl(baseUrl, path)}${query ? `?${query}` : ''}`;

  const body = hasExplicitBody
    ? JSON.stringify(restBody === undefined ? bodyFields : restBody)
    : undefined;

  return {
    url,
    method: binding.method,
    ...(body === undefined ? {} : { body }),
  };
}
