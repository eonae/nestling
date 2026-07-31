/**
 * Секция `http:` контракта — **данные адресации**, а не описание исполнения.
 *
 * `name` контракта это адрес на шине; `http:` даёт ему адрес на HTTP-проводе.
 * Разворачивается в ту же плоскую bind-карту, что и словарь HTTP-декларации,
 * тем же кодом (`computeHttpBinding`) — мест вызова два, реализация канона
 * одна.
 *
 * Правило, которое приходится держать: в контракте появляются только секции,
 * из которых выводится **адресация и размещение**. Ничего про исполнение —
 * `handle`, `pipeline`, `deps`, `detached` — контракт не принимает, и это
 * проверяется, а не подразумевается.
 */

import type { AnyOutput, AnyPayload, InferStreamItem } from '../io/index.js';

import type { BindMap, HttpMethod, SseConfig } from './binding.js';

/**
 * Развёрнутая форма секции: те же поля, что принимает HTTP-словарь
 * декларации, за вычетом всего, что относится к обработке запроса.
 */
export interface HttpContractSection<
  Path extends string = string,
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
> {
  /** HTTP-метод операции */
  method: HttpMethod;

  /** Шаблон пути; path-параметры объявляются `:name` */
  path: Path;

  /**
   * Пометки размещения: «поле → место». Всё, что не помечено и не совпало с
   * path-параметром, размещается по канону — query для методов без тела,
   * body для остальных.
   */
  bind?: BindMap<Path, I>;

  /**
   * Сырые байты тела в стартовом контексте реализации — для проверки
   * webhook-подписей. Свойство **операции**: подпись считается по тем же
   * байтам, что отправил клиент, поэтому объявляется там, где обе стороны
   * его видят.
   */
  rawBody?: boolean;

  /** SSE-специфика ответа; легальна только при `output: events(...)` */
  sse?: SseConfig<InferStreamItem<O>>;
}

/**
 * Секция `http:`: сахар-строка `'<METHOD> <path>'` либо развёрнутая запись.
 *
 * Строка — сахар ровно для случая без пометок: `bind`, `rawBody` и `sse` ею
 * не выразить, и притворяться, что выразимы, незачем.
 */
export type ContractHttp<
  Path extends string = string,
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
> = string | HttpContractSection<Path, I, O>;

/** Поля, которые контракт не принимает: они про исполнение, а не про адрес */
const EXECUTION_FIELDS = ['handle', 'pipeline', 'deps', 'detached'] as const;

/** Секция после разбора: развёрнутая форма с нетипизированным методом */
export interface ParsedHttpSection {
  method: string;
  path: string;
  bind?: Readonly<Record<string, unknown>>;
  rawBody?: boolean;
  sse?: SseConfig;
}

/**
 * Приводит обе формы записи к одной.
 *
 * Строковая форма разбирается **строго**: ровно один разделяющий пробел,
 * непустой метод, непустой путь. Послаблений нет намеренно — «`POST  /users`
 * с двумя пробелами тоже сойдёт» превращает адрес в угадайку, а адрес
 * читают обе стороны провода.
 *
 * @param where - как назвать контракт в тексте ошибки
 */
export function parseHttpSection(
  http: unknown,
  where: string,
): ParsedHttpSection {
  if (typeof http === 'string') {
    const parts = http.split(' ');

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `${where}: the string form of 'http' must be '<METHOD> <path>' with ` +
          `exactly one separating space (for example 'POST /users/:id'), got ` +
          `${JSON.stringify(http)}. Use the record form ` +
          `{ method, path, bind?, rawBody?, sse? } when you need marks.`,
      );
    }

    return { method: parts[0], path: parts[1] };
  }

  if (typeof http !== 'object' || http === null || Array.isArray(http)) {
    throw new TypeError(
      `${where}: 'http' must be either the string '<METHOD> <path>' or a ` +
        `record { method, path, bind?, rawBody?, sse? }, got ` +
        `${JSON.stringify(http)}.`,
    );
  }

  const record = http as Record<string, unknown>;

  for (const field of EXECUTION_FIELDS) {
    if (record[field] !== undefined) {
      throw new TypeError(
        `${where}: 'http.${field}' describes how a request is handled, and a ` +
          `contract declares only where it is addressed. Move it to the ` +
          `implementation (httpEndpoint({ contract, … }) or implement(...)).`,
      );
    }
  }

  if (typeof record.method !== 'string' || record.method.length === 0) {
    throw new TypeError(
      `${where}: 'http.method' must be a non-empty HTTP method string.`,
    );
  }

  return {
    method: record.method,
    path: record.path as string,
    ...(record.bind === undefined
      ? {}
      : { bind: record.bind as Readonly<Record<string, unknown>> }),
    ...(record.rawBody === undefined
      ? {}
      : { rawBody: record.rawBody as boolean }),
    ...(record.sse === undefined ? {} : { sse: record.sse as SseConfig }),
  };
}
