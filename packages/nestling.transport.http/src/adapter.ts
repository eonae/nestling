import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';

import type { Cookie, HttpResponseMeta } from './response.js';
import { DEFAULT_REDIRECT_STATUS } from './response.js';
import { HTTP_TRANSPORT_NAME } from './token.js';

import type {
  ErrorResponseContext,
  FormKind,
  ProcessingStatus,
  ResponseContext,
  StreamSummary,
  SuccessResponseContext,
} from '@nestling/app';
import { isAsyncIterable, isMidStreamFailure } from '@nestling/app';
import type { RedirectStatus, SseConfig } from '@nestling/operations';
import { InternalError, untilAborted } from '@nestling/operations';

/** Соответствие статусов ответа кодам HTTP */

const STATUS_MAP: Record<ProcessingStatus, number> = {
  ok: 200,
  created: 201,
  accepted: 202,
  no_content: 204,
  payment_required: 402,
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  // «вход больше допустимого»: лимит item-цепочки, файл сверх upload({maxSize})
  payload_too_large: 413,
  too_many_requests: 429,
  internal_error: 500,
  not_implemented: 501,
  service_unavailable: 503,
  // 504, а не 408: TIMEOUT в ядре — «операция не уложилась в бюджет»,
  // тогда как 408 про то, что клиент не дослал запрос.
  timeout: 504,
};

/** Период heartbeat SSE по умолчанию */
export const DEFAULT_SSE_HEARTBEAT = 15_000;

/** Имя события, зарезервированное за отказом посреди потока */
export const SSE_ERROR_EVENT = 'error';

/**
 * Настройки SSE-ответа.
 *
 * Тип объявлен в `@nestling/operations` рядом с bind-картой; здесь он
 * реэкспортирован, чтобы автор декларации брал его оттуда же, откуда
 * `httpEndpoint`.
 */
export type { SseConfig } from '@nestling/operations';

/** Параметры отправки ответа помимо самого значения */
export interface SendOptions {
  /** Вид формы `output`; определяет способ кадрирования */
  kind?: FormKind;

  /** Поле `sse` HTTP-декларации */
  sse?: SseConfig;

  /** Дефолтный период heartbeat транспорта */
  heartbeat?: number;

  /** Итог запроса: транспорт дописывает в него байты */
  summary?: StreamSummary;

  /** Сигнал отмены запроса: дисконнект клиента или остановка транспорта */
  signal?: AbortSignal;

  /** Объявленный декларацией статус редиректа (поле `redirect`) */
  redirect?: RedirectStatus;

  /** Адрес endpoint'а; попадает в текст ошибки транспорта */
  pattern?: string;
}

/**
 * Переводит статус ответа в код HTTP.
 *
 * Функция публична: генератор документации (`@nestling/openapi`) берёт
 * коды отсюда, чтобы документ совпадал с тем, что отдаёт сервер.
 * Неизвестный статус даёт `200`; из типизированного кода этот случай
 * недостижим, так как набор статусов закрыт.
 *
 * @param status - Статус ответа (`'created'`, `'conflict'`, …)
 * @returns Код HTTP-ответа
 */
export function httpCodeOf(status?: ProcessingStatus): number {
  if (!status) {
    return 200;
  }

  return STATUS_MAP[status] ?? 200;
}

function countBytes(summary: StreamSummary | undefined, bytes: number): void {
  if (summary) {
    summary.bytesOut = (summary.bytesOut ?? 0) + bytes;
  }
}

/**
 * Пишет чанк и ждёт, пока он уйдёт в сокет: иначе медленный клиент
 * превращал бы ответ в неограниченный буфер в памяти сервера.
 */
function writeChunk(
  res: ServerResponse,
  chunk: string | Buffer | Uint8Array,
  summary?: StreamSummary,
): Promise<void> {
  return new Promise((resolve, reject) => {
    res.write(chunk, (error) => {
      if (error) {
        reject(error);
        return;
      }
      countBytes(summary, Buffer.byteLength(chunk as never));
      resolve();
    });
  });
}

/** Кодирует NDJSON-кадр: строки и байты как есть, объекты — JSON и `\n` */
function encodeNdjson(item: unknown): string | Buffer | Uint8Array {
  if (typeof item === 'string') {
    return item;
  }
  if (Buffer.isBuffer(item) || item instanceof Uint8Array) {
    return item;
  }
  return `${JSON.stringify(item)}\n`;
}

/** Кодирует SSE-кадр: `id:` и `event:` (если заданы), `data:`, пустая строка */
function encodeSseFrame(item: unknown, sse?: SseConfig): string {
  const lines: string[] = [];

  if (sse?.id) {
    lines.push(`id: ${String(sse.id(item))}`);
  }

  if (sse?.event) {
    const name = sse.event(item);
    if (name === SSE_ERROR_EVENT) {
      throw new Error(
        `SSE event name '${SSE_ERROR_EVENT}' is reserved for mid-stream ` +
          `failures and cannot be produced by 'sse.event'.`,
      );
    }
    lines.push(`event: ${name}`);
  }

  lines.push(`data: ${JSON.stringify(item)}`);

  return `${lines.join('\n')}\n\n`;
}

/**
 * Тело отказа посреди потока.
 *
 * Отказ уже прошёл проверку `errors`: незадекларированный стал `internal_error`,
 * оригинал записан в логгер `dispatch`.
 */
function midStreamBody(error: unknown): { error: string; code?: string } {
  if (isMidStreamFailure(error)) {
    const { value } = error.response;
    return value.code === undefined
      ? { error: value.error }
      : { error: value.error, code: value.code };
  }

  return { error: 'Internal server error' };
}

/**
 * Пишет конечный поток как NDJSON.
 *
 * Отказ посреди потока обрывает соединение: заголовки уже ушли, статус
 * сменить нельзя, а незавершённый chunked-ответ сообщает клиенту, что
 * данные неполны.
 */
async function writeNdjson(
  res: ServerResponse,
  source: AsyncIterable<unknown>,
  options: SendOptions,
): Promise<void> {
  try {
    for await (const item of untilAborted(source, options.signal)) {
      if (res.destroyed || res.writableEnded) {
        break;
      }
      await writeChunk(res, encodeNdjson(item), options.summary);
    }
  } catch {
    // Отказ уже прошёл проверку `errors` и `.finally`-юниты; транспорту
    // остаётся оборвать ответ
    res.destroy();
    return;
  }

  if (!res.destroyed && !res.writableEnded) {
    res.end();
  }
}

/**
 * Пишет открытую подписку как SSE.
 *
 * Отказ посреди потока уходит событием с именем `error`, после чего
 * соединение закрывается.
 */
async function writeSse(
  res: ServerResponse,
  source: AsyncIterable<unknown>,
  options: SendOptions,
): Promise<void> {
  res.flushHeaders();

  const period =
    options.sse?.heartbeat ?? options.heartbeat ?? DEFAULT_SSE_HEARTBEAT;

  // Heartbeat — SSE-комментарий, а не элемент потока: в счётчики и
  // лимиты не входит
  const timer =
    period > 0
      ? setInterval(() => {
          if (!res.destroyed && !res.writableEnded) {
            res.write(': heartbeat\n\n');
          }
        }, period)
      : undefined;
  timer?.unref?.();

  try {
    for await (const item of untilAborted(source, options.signal)) {
      if (res.destroyed || res.writableEnded) {
        break;
      }
      await writeChunk(res, encodeSseFrame(item, options.sse), options.summary);
    }
  } catch (error) {
    if (!res.destroyed && !res.writableEnded) {
      await writeChunk(
        res,
        `event: ${SSE_ERROR_EVENT}\ndata: ${JSON.stringify(
          midStreamBody(error),
        )}\n\n`,
        options.summary,
      );
    }
  } finally {
    clearInterval(timer);
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }
}

/**
 * Сериализует cookie в значение заголовка `Set-Cookie`.
 *
 * Значение пишется как есть: кодирование — дело автора, потому что
 * сервер не знает, что клиент ожидает получить обратно.
 */
function serializeCookie(cookie: Cookie): string {
  const parts = [`${cookie.name}=${cookie.value}`];

  if (cookie.maxAge !== undefined) {
    parts.push(`Max-Age=${cookie.maxAge}`);
  }
  if (cookie.expires !== undefined) {
    parts.push(`Expires=${cookie.expires.toUTCString()}`);
  }
  if (cookie.path !== undefined) {
    parts.push(`Path=${cookie.path}`);
  }
  if (cookie.domain !== undefined) {
    parts.push(`Domain=${cookie.domain}`);
  }
  if (cookie.secure === true) {
    parts.push('Secure');
  }
  if (cookie.httpOnly === true) {
    parts.push('HttpOnly');
  }
  if (cookie.sameSite !== undefined) {
    parts.push(
      `SameSite=${cookie.sameSite[0].toUpperCase()}${cookie.sameSite.slice(1)}`,
    );
  }

  return parts.join('; ');
}

/** Ответ-отказ транспорта: программная ошибка автора endpoint'а */
function transportFailure(message: string): ErrorResponseContext {
  return {
    isSuccess: false,
    status: 'internal_error',
    value: { error: message, code: InternalError.code },
  };
}

/**
 * Проверяет метаданные протокола в контексте ответа.
 *
 * Транспорт читает их, только если имя совпадает с его собственным:
 * иначе endpoint вернул ответ чужого транспорта, и это ошибка автора, а
 * не клиента. Редирект без объявленного `redirect` — та же ошибка: без
 * поля документ разошёлся бы с поведением.
 *
 * @returns Ответ-отказ, если метаданные читать нельзя
 */
function checkTransportMeta(
  response: SuccessResponseContext,
  options: SendOptions,
): ErrorResponseContext | undefined {
  const carried = response.transport;
  if (!carried) {
    return undefined;
  }

  const where = `Endpoint '${options.pattern ?? 'unknown'}'`;

  if (carried.name !== HTTP_TRANSPORT_NAME) {
    return transportFailure(
      `${where} is served by transport '${HTTP_TRANSPORT_NAME}', but its ` +
        `handler returned a response of transport '${carried.name}'.`,
    );
  }

  const meta = carried.meta as HttpResponseMeta;

  if (meta.location !== undefined && options.redirect === undefined) {
    return transportFailure(
      `${where} returned a redirect, but its declaration does not declare ` +
        `'redirect' — add 'redirect: <status>' to it.`,
    );
  }

  return undefined;
}

/** Метаданные HTTP-ответа из контекста; у ответа без конверта их нет */
function httpMetaOf(response: ResponseContext): HttpResponseMeta | undefined {
  return response.isSuccess
    ? (response.transport?.meta as HttpResponseMeta | undefined)
    : undefined;
}

/**
 * Код ответа: статус редиректа перекрывает статус результата.
 *
 * Статус берётся из вызова `HttpResponse.redirect`, затем из поля
 * `redirect` декларации, затем `302`.
 */
function statusOf(
  response: ResponseContext,
  meta: HttpResponseMeta | undefined,
  options: SendOptions,
): number {
  return meta?.location === undefined
    ? httpCodeOf(response.status)
    : (meta.status ?? options.redirect ?? DEFAULT_REDIRECT_STATUS);
}

/**
 * Заголовки потокового ответа по форме `output`.
 *
 * Ставятся до заголовков `HttpResponse`: заголовки ответа принадлежат
 * хендлеру и перекрывают заголовки формы.
 */
function setStreamHeaders(res: ServerResponse, kind: FormKind): void {
  if (kind === 'events') {
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    return;
  }

  res.setHeader('content-type', 'application/x-ndjson');
}

/**
 * Отправляет `ResponseContext` в `ServerResponse`.
 *
 * Способ кадрирования выбирается по объявленной форме `output`, а не по
 * типу значения: `stream` даёт NDJSON, `events` — SSE, остальное — JSON.
 * Заголовки `HttpResponse` перекрывают заголовки формы; имя приводится к
 * нижнему регистру, поэтому `'Content-Type'` хендлера заменяет
 * `content-type` формы, а не добавляется вторым заголовком. Каждая cookie
 * уходит отдельным заголовком `Set-Cookie`.
 *
 * Ответ формы `value` уходит одним `writeHead` с `content-length` и телом
 * в буфере: так `node:http` не проверяет имена заголовков по одному и не
 * считает длину тела второй раз.
 */
export async function sendResponse(
  res: ServerResponse,
  context: ResponseContext,
  options: SendOptions = {},
): Promise<void> {
  // Метаданные чужого транспорта и незаявленный редирект — ошибка автора
  // endpoint'а: ответ заменяется отказом до записи заголовков
  const response = context.isSuccess
    ? (checkTransportMeta(context, options) ?? context)
    : context;

  const meta = httpMetaOf(response);
  const status = statusOf(response, meta, options);
  const kind = options.kind ?? 'value';
  const streaming =
    response.isSuccess &&
    (kind === 'stream' || kind === 'events') &&
    isAsyncIterable(response.value);

  if (streaming) {
    res.statusCode = status;
    setStreamHeaders(res, kind);
    // Заголовки ответа уходят до первого кадра: после него статус и
    // заголовки уже отправлены клиенту
    if (meta?.headers) {
      for (const [key, value] of Object.entries(meta.headers)) {
        res.setHeader(key, value);
      }
    }
    if (meta?.cookies?.length) {
      res.setHeader('set-cookie', meta.cookies.map(serializeCookie));
    }

    await (kind === 'events'
      ? writeSse(res, response.value as AsyncIterable<unknown>, options)
      : writeNdjson(res, response.value as AsyncIterable<unknown>, options));
    return;
  }

  // value === null означает пустой ответ
  const empty = response.value === null;
  const headers: OutgoingHttpHeaders = {};

  if (!empty) {
    headers['content-type'] = 'application/json';
  }
  if (meta) {
    if (meta.headers) {
      for (const [key, value] of Object.entries(meta.headers)) {
        headers[key.toLowerCase()] = value;
      }
    }
    if (meta.cookies?.length) {
      headers['set-cookie'] = meta.cookies.map(serializeCookie);
    }
    if (meta.location !== undefined) {
      headers.location = meta.location;
    }
  }

  if (empty) {
    res.writeHead(status, headers);
    res.end();
    return;
  }

  const body = Buffer.from(JSON.stringify(response.value) ?? '');
  headers['content-length'] = body.length;
  countBytes(options.summary, body.length);
  res.writeHead(status, headers);
  res.end(body);
}
