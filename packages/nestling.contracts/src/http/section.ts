/**
 * Секция `http` операции: HTTP-адрес и размещение полей.
 *
 * `name` операции — адрес на шине, `http` — адрес по HTTP. Секция
 * превращается в ту же bind-карту, что и HTTP-декларация endpoint'а, тем же
 * кодом (`computeHttpBinding`).
 *
 * Поля, описывающие исполнение (`handle`, `pipeline`, `deps`, `detached`),
 * операция не принимает: `parseHttpSection` отвергает их с ошибкой.
 */

import type { AnyOutput, AnyPayload, InferStreamItem } from '../io/index.js';

import type { BindMap, HttpMethod, SseConfig } from './binding.js';

/**
 * Объектная форма секции: те же поля, что у HTTP-декларации endpoint'а,
 * кроме относящихся к обработке запроса.
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
   * Пометки размещения полей. Поле без пометки и не совпавшее с
   * path-параметром попадает в query у методов без тела и в body у
   * остальных.
   */
  bind?: BindMap<Path, I>;

  /**
   * Передавать сырые байты тела в контекст реализации; нужно для проверки
   * подписей webhook'ов. Объявляется в операции, потому что подпись
   * считается по тем же байтам, что отправил клиент.
   */
  rawBody?: boolean;

  /** Настройки SSE-ответа; допустимы только при `output: events(...)` */
  sse?: SseConfig<InferStreamItem<O>>;
}

/**
 * Секция `http`: строка `'<METHOD> <path>'` или объект.
 *
 * Строка подходит только для адреса без пометок: `bind`, `rawBody` и `sse`
 * задаются объектной формой.
 */
export type OperationHttp<
  Path extends string = string,
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
> = string | HttpContractSection<Path, I, O>;

/** Поля исполнения, которые операция не принимает */
const EXECUTION_FIELDS = ['handle', 'pipeline', 'deps', 'detached'] as const;

/** Секция после разбора: объектная форма с методом-строкой */
export interface ParsedHttpSection {
  method: string;
  path: string;
  bind?: Readonly<Record<string, unknown>>;
  rawBody?: boolean;
  sse?: SseConfig;
}

/**
 * Приводит обе формы записи секции к объектной.
 *
 * Строковая форма разбирается строго: ровно один пробел, непустой метод,
 * непустой путь. Адрес читают обе стороны, поэтому послаблений нет.
 *
 * @param where - Как назвать операция в тексте ошибки
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
