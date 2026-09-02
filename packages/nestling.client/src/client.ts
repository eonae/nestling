/**
 * `makeClient` — типизированный HTTP-клиент из значений-операций.
 *
 * Клиент это **значение**: он ничего не регистрирует, не требует DI и не
 * зависит от серверного кода. Всё, что нужно для вызова — адрес, размещение
 * полей, схема ответа, множество отказов, — приходит одним импортом
 * операции.
 *
 * Call-site эквивалентен вызывателю операции его вида: `request` даёт
 * `Ok | Fail`, как `port.call(...)`; `command` — `Promise<void>`, как
 * `emitter.emit(...)`. Та же ветвящаяся логика работает без правок.
 */

import type { ClientConfig, ClientHeaders, ClientMeta } from './config.js';
import { buildRequest } from './request.js';
import { readFailure, readSuccess, unknownFailure } from './response.js';

import type {
  AnyFailDefinition,
  AnyOperation,
  CommandOperation,
  DeadlineExceeded,
  Fail,
  FailOf,
  InputOf,
  Ok,
  OperationFailsOf,
  OutputOf,
  RequestOperation,
  UnknownError,
} from '@nestling/contracts';
import {
  DeadlineExceeded as DeadlineExceededFail,
  describeForm,
  isFail,
  isPrimitiveLeaf,
} from '@nestling/contracts';

/**
 * Отказы, которые клиент добавляет к объявленным операцией.
 *
 * То же закрытие, что у порта: множество ответов — `E ∪ UnknownError`, и
 * `DeadlineExceeded` входит в него как kernel-код механизма бюджета.
 */
export type ClientFail =
  | FailOf<typeof UnknownError>
  | FailOf<typeof DeadlineExceeded>;

/** Множество ответов метода: успех, объявленный отказ или kernel-отказ */
export type ClientResult<C extends AnyOperation> =
  | Ok<OutputOf<C>>
  | OperationFailsOf<C>
  | ClientFail;

/**
 * Аргументы метода: операция без формы `input` зовётся без payload'а.
 *
 * Тот же приём, что у порта: «забыл payload» — ошибка компиляции, а не
 * отказ валидации после похода в сеть.
 */
export type ClientArgs<C extends AnyOperation> =
  undefined extends InputOf<C>
    ? [payload?: InputOf<C>, meta?: ClientMeta]
    : [payload: InputOf<C>, meta?: ClientMeta];

/**
 * Метод клиента, выведенный по виду операции.
 *
 * `event` не имеет метода вовсе: событие это broadcast-факт с 0..N
 * подписчиками, а HTTP-вызов адресует ровно одного получателя.
 */
export type ClientMethod<C extends AnyOperation> =
  C extends RequestOperation<any, any, any>
    ? (...args: ClientArgs<C>) => Promise<ClientResult<C>>
    : C extends CommandOperation<any, any, any>
      ? (...args: ClientArgs<C>) => Promise<void>
      : never;

/** API-объект: метод на каждый ключ записи, имена даёт потребитель */
export type Client<R extends Record<string, AnyOperation>> = {
  [K in keyof R]: ClientMethod<R[K]>;
};

/** Формы io, для которых клиент v1 не существует */
const STREAMING_FORMS = new Set(['stream', 'events', 'multipart']);

function assertAbsoluteBaseUrl(baseUrl: unknown): asserts baseUrl is string {
  const valid =
    typeof baseUrl === 'string' &&
    URL.canParse(baseUrl) &&
    new URL(baseUrl).protocol.length > 0;

  if (!valid) {
    throw new TypeError(
      `makeClient({ … }, { baseUrl }): 'baseUrl' must be an absolute URL ` +
        `(for example 'https://api.example.com'), got ` +
        `${JSON.stringify(baseUrl)}. The client joins it with the contract's ` +
        `path literally, so a relative base has nothing to resolve against.`,
    );
  }
}

/**
 * Fail-fast пригодности операции — **в момент создания клиента**.
 *
 * Отложенная диагностика («упадёт при первом вызове») здесь неуместна:
 * запись операций известна целиком, и всё, что можно проверить, проверимо
 * сразу. Каждый текст называет ключ метода — искать по имени операции в
 * чужом файле потребителю неоткуда.
 */
function assertUsable(
  key: string,
  contract: unknown,
): asserts contract is AnyOperation {
  const where = `makeClient({ ${key}: … }, { … })`;
  const value = contract as AnyOperation | undefined;

  if (typeof value?.name !== 'string' || typeof value.kind !== 'string') {
    throw new TypeError(
      `${where}: '${key}' must be an operation created by makeRequest.`,
    );
  }

  if (value.kind === 'event') {
    throw new TypeError(
      `${where}: contract '${value.name}' is an 'event' — a broadcast fact ` +
        `with 0..N subscribers, while an HTTP call addresses exactly one ` +
        `receiver. Declare it as a 'command' if the intent is addressed to a ` +
        `single owner.`,
    );
  }

  if (!value.http) {
    throw new TypeError(
      `${where}: contract '${value.name}' has no 'http:' section, so it ` +
        `carries no HTTP address. Declare 'http: <METHOD> <path>' on the ` +
        `contract, or call it over the bus through its port.`,
    );
  }

  for (const slot of ['input', 'output'] as const) {
    const form = describeForm(value[slot]);

    if (STREAMING_FORMS.has(form.kind)) {
      throw new TypeError(
        `${where}: contract '${value.name}' declares form '${form.kind}' in ` +
          `'${slot}'. The streaming client (NDJSON for stream(...), SSE for ` +
          `events(...)) is designed separately and does not exist yet.`,
      );
    }

    if (form.leaf !== undefined && isPrimitiveLeaf(form.leaf)) {
      throw new TypeError(
        `${where}: contract '${value.name}' declares '${form.leaf}' in ` +
          `'${slot}'. The client speaks JSON only in v1.`,
      );
    }
  }
}

/** Свежие ambient-заголовки на этот запрос */
async function resolveHeaders(
  headers: ClientHeaders | undefined,
): Promise<Record<string, string>> {
  if (!headers) {
    return {};
  }
  return typeof headers === 'function' ? headers() : headers;
}

/**
 * Композирует сигнал отмены из пользовательского и бюджетного.
 *
 * Бюджет — абсолютный момент, поэтому в таймер передаётся остаток, а не
 * исходная длительность: между вычислением бюджета и вызовом мог пройти
 * любой `await`.
 */
function composeSignal(meta: ClientMeta | undefined): AbortSignal | undefined {
  const signals: AbortSignal[] = [];

  if (meta?.signal) {
    signals.push(meta.signal);
  }
  if (meta?.deadline) {
    signals.push(AbortSignal.timeout(meta.deadline.getTime() - Date.now()));
  }

  if (signals.length === 0) {
    return undefined;
  }

  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

/** Тело ответа как JSON: пустое тело даёт `null`, не-JSON-тело — ошибка */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.length === 0 ? null : JSON.parse(text);
}

/** Один вызов: сборка запроса, поход в сеть, разбор ответа */
async function invoke(
  key: string,
  contract: AnyOperation,
  config: ClientConfig,
  payload: unknown,
  meta: ClientMeta | undefined,
): Promise<Ok<unknown> | Fail<string | undefined, unknown>> {
  const where = `client.${key}()`;
  const binding = contract.http as NonNullable<AnyOperation['http']>;

  // Бюджет проверяется **до** отправки: ходить в сеть за заведомо
  // просроченным ответом незачем
  if (meta?.deadline && meta.deadline.getTime() <= Date.now()) {
    return DeadlineExceededFail();
  }

  // Дефект использования, а не ответ сервиса: непредставимое query-поле —
  // ошибка программиста, и она бросается, а не возвращается
  const request = buildRequest(binding, config.baseUrl, payload, where);

  let response: Response;
  try {
    const headers = await resolveHeaders(config.headers);
    const doFetch = config.fetch ?? globalThis.fetch;

    response = await doFetch(request.url, {
      method: request.method,
      headers: {
        ...headers,
        // Заголовок ставится только когда тело есть: `Content-Type` у
        // запроса без тела — ложь о содержимом
        ...(request.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
      },
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(composeSignal(meta) === undefined
        ? {}
        : { signal: composeSignal(meta) }),
    });
  } catch (error) {
    return unknownFailure(
      `${where}: the request did not complete (${describeError(error)}).`,
      error,
    );
  }

  let body: unknown;
  try {
    body = await readBody(response);
  } catch (error) {
    return unknownFailure(
      `${where}: the service answered ${response.status.toString()} with a ` +
        `body that is not JSON.`,
      error,
    );
  }

  if (response.ok) {
    return readSuccess(
      response.status,
      body,
      contract.output,
      config.validateOutput ?? true,
      where,
    ) as Ok<unknown> | Fail<string | undefined, unknown>;
  }

  return readFailure(
    response.status,
    body,
    contract.errors as readonly AnyFailDefinition[] | undefined,
    where,
  ) as Fail<string | undefined, unknown>;
}

/** Короткое описание сбоя сети для текста отказа */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.name === 'TimeoutError'
      ? 'aborted'
      : error.message;
  }
  return String(error);
}

/**
 * Строит API-объект по записи операций.
 *
 * Методы именует **потребитель** — ключами записи. Вывода имён из `name`
 * операции (парсинга `'users.create'` во вложенные объекты) нет: имя
 * операции это адрес на шине, и превращать адрес в форму чужого API
 * значило бы навязывать её.
 *
 * @param record - `имя метода → операция`
 * @param config - адрес сервиса, ambient-заголовки, `fetch`, валидация
 * @throws {TypeError} Операция без `http:`, вид `event`, потоковая или
 * multipart-форма io, не-JSON тело, неабсолютный `baseUrl`
 *
 * @example
 * ```typescript
 * const api = makeClient(
 *   { createUser: CreateUser, getUser: GetUser },
 *   { baseUrl: 'https://api.example.com', headers: () => ({ authorization: token() }) },
 * );
 *
 * const result = await api.createUser({ email: 'a@b.c' });
 * if (EmailTaken.is(result)) { … }
 * ```
 */
export function makeClient<R extends Record<string, AnyOperation>>(
  record: R,
  config: ClientConfig,
): Client<R> {
  assertAbsoluteBaseUrl(config.baseUrl);

  const api: Record<string, unknown> = {};

  for (const [key, contract] of Object.entries(record)) {
    assertUsable(key, contract);

    const isCommand = contract.kind === 'command';

    api[key] = async (
      payload?: unknown,
      meta?: ClientMeta,
    ): Promise<unknown> => {
      const result = await invoke(key, contract, config, payload, meta);

      if (!isCommand) {
        return result;
      }

      // У fire-and-forget нет бизнес-результата, который потребитель обязан
      // разбирать, — поэтому отказ бросается, как у эмиттера
      if (isFail(result)) {
        throw result;
      }

      return undefined;
    };
  }

  return api as Client<R>;
}
