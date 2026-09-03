import type { ServerResponse } from 'node:http';

import type { SseConfig } from '@nestling/operations';
import type {
  FormKind,
  ProcessingStatus,
  ResponseContext,
  StreamSummary,
} from '@nestling/pipeline';
import { isAsyncIterable, isMidStreamFailure } from '@nestling/pipeline';
import { untilAborted } from '@nestling/streams';

/** Соответствие статусов ответа кодам HTTP */
/* eslint-disable prettier/prettier */
const STATUS_MAP: Record<ProcessingStatus, number> = {
  'ok': 200,
  'created': 201,
  'accepted': 202,
  'no_content': 204,
  'payment_required': 402,
  'bad_request': 400,
  'unauthorized': 401,
  'forbidden': 403,
  'not_found': 404,
  'conflict': 409,
  // «вход больше допустимого»: лимит item-цепочки, файл сверх upload({maxSize})
  'payload_too_large': 413,
  'too_many_requests': 429,
  'internal_error': 500,
  'not_implemented': 501,
  'service_unavailable': 503,
  // 504, а не 408: TIMEOUT в ядре — «операция не уложилась в бюджет»,
  // тогда как 408 про то, что клиент не дослал запрос.
  'timeout': 504,
};
/* eslint-enable prettier/prettier */

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
 * оригинал ушёл в хук `onUnknownFail`.
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
 * Заголовки, которые транспорт ставит по форме `output`.
 *
 * Ставятся до заголовков `Ok`: заголовки ответа принадлежат хендлеру и
 * перекрывают заголовки формы.
 */
function setFormHeaders(
  res: ServerResponse,
  kind: FormKind,
  streaming: boolean,
  empty: boolean,
): void {
  if (streaming && kind === 'events') {
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    return;
  }

  if (streaming) {
    res.setHeader('content-type', 'application/x-ndjson');
    return;
  }

  if (!empty) {
    res.setHeader('content-type', 'application/json');
  }
}

/**
 * Отправляет `ResponseContext` в `ServerResponse`.
 *
 * Способ кадрирования выбирается по объявленной форме `output`, а не по
 * типу значения: `stream` даёт NDJSON, `events` — SSE, остальное — JSON.
 * Заголовки `Ok` пишутся как есть после заголовков формы.
 */
export async function sendResponse(
  res: ServerResponse,
  response: ResponseContext,
  options: SendOptions = {},
): Promise<void> {
  res.statusCode = httpCodeOf(response.status);

  const kind = options.kind ?? 'value';
  const streaming =
    response.isSuccess &&
    (kind === 'stream' || kind === 'events') &&
    isAsyncIterable(response.value);

  // value === null означает пустой ответ
  const empty = response.value === null;

  setFormHeaders(res, kind, streaming, empty);

  if (response.headers) {
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
  }

  if (streaming) {
    await (kind === 'events'
      ? writeSse(res, response.value as AsyncIterable<unknown>, options)
      : writeNdjson(res, response.value as AsyncIterable<unknown>, options));
    return;
  }

  if (empty) {
    res.end();
    return;
  }

  const body = JSON.stringify(response.value);
  countBytes(options.summary, Buffer.byteLength(body ?? ''));
  res.end(body);
}
