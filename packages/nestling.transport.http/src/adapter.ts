import type { ServerResponse } from 'node:http';

import type { SseConfig } from '@nestling/contracts';
import type {
  FormKind,
  ProcessingStatus,
  ResponseContext,
  StreamSummary,
} from '@nestling/pipeline';
import { isAsyncIterable, isMidStreamFailure } from '@nestling/pipeline';
import { untilAborted } from '@nestling/streams';

/**
 * Маппинг строковых статусов на HTTP коды
 */
/* eslint-disable prettier/prettier */
const STATUS_MAP: Record<ProcessingStatus, number> = {
  'OK': 200,
  'CREATED': 201,
  'ACCEPTED': 202,
  'NO_CONTENT': 204,
  'PAYMENT_REQUIRED': 402,
  'BAD_REQUEST': 400,
  'UNAUTHORIZED': 401,
  'FORBIDDEN': 403,
  'NOT_FOUND': 404,
  'CONFLICT': 409,
  // «вход больше допустимого»: лимит item-цепочки, файл сверх upload({maxSize})
  'PAYLOAD_TOO_LARGE': 413,
  'TOO_MANY_REQUESTS': 429,
  'INTERNAL_ERROR': 500,
  'NOT_IMPLEMENTED': 501,
  'SERVICE_UNAVAILABLE': 503,
  // 504, а не 408: TIMEOUT в ядре — «операция не уложилась в бюджет»,
  // тогда как 408 про то, что клиент не дослал запрос.
  'TIMEOUT': 504,
};
/* eslint-enable prettier/prettier */

/** Период heartbeat SSE по умолчанию */
export const DEFAULT_SSE_HEARTBEAT = 15_000;

/** Имя события, зарезервированное за mid-stream отказом */
export const SSE_ERROR_EVENT = 'error';

/**
 * SSE-специфика носителя декларации.
 *
 * Определение живёт в `@nestling/contracts` рядом с bind-картой, которая
 * его и везёт; здесь оно реэкспортируется, чтобы автор HTTP-декларации брал
 * тип оттуда же, откуда `httpEndpoint`.
 */
export type { SseConfig } from '@nestling/contracts';

/** Что транспорт знает об отправляемом ответе помимо самого значения */
export interface SendOptions {
  /** Вид формы `output` — он и определяет framing */
  kind?: FormKind;

  /** Секция `sse` HTTP-словаря декларации */
  sse?: SseConfig;

  /** Дефолтный период heartbeat транспорта */
  heartbeat?: number;

  /** Итог запроса: транспорт дописывает в него байты */
  summary?: StreamSummary;

  /** Сигнал отмены запроса: дисконнект и graceful shutdown */
  signal?: AbortSignal;
}

/**
 * Парсит строковый статус в HTTP код
 */
function parseStatus(status?: ProcessingStatus): number {
  if (!status) {
    return 200;
  }

  // Иначе используем маппинг
  return STATUS_MAP[status] ?? 200;
}

function countBytes(summary: StreamSummary | undefined, bytes: number): void {
  if (summary) {
    summary.bytesOut = (summary.bytesOut ?? 0) + bytes;
  }
}

/**
 * Пишет чанк, дожидаясь его слива: без этого backpressure медленного
 * клиента превращается в неограниченный буфер в памяти сервера.
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

/** NDJSON-кадр: строки и байты уходят как есть, объекты — JSON + перевод строки */
function encodeNdjson(item: unknown): string | Buffer | Uint8Array {
  if (typeof item === 'string') {
    return item;
  }
  if (Buffer.isBuffer(item) || item instanceof Uint8Array) {
    return item;
  }
  return `${JSON.stringify(item)}\n`;
}

/** SSE-кадр: опциональные `id:`/`event:`, затем `data:` и пустая строка */
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
 * Тело mid-stream отказа.
 *
 * Отказ приезжает уже нормализованным стражем границы: незадекларированный
 * стал `UNKNOWN`, оригинал ушёл в диагностический хук.
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
 * NDJSON-framing конечного потока.
 *
 * Mid-stream отказ обрывает соединение: заголовки ушли, статус сменить
 * нельзя, и незавершённый chunked-ответ — это и есть честный сигнал
 * «данные неполны».
 */
async function writeNdjson(
  res: ServerResponse,
  source: AsyncIterable<unknown>,
  options: SendOptions,
): Promise<void> {
  if (!res.hasHeader('content-type')) {
    res.setHeader('content-type', 'application/x-ndjson');
  }

  try {
    for await (const item of untilAborted(source, options.signal)) {
      if (res.destroyed || res.writableEnded) {
        break;
      }
      await writeChunk(res, encodeNdjson(item), options.summary);
    }
  } catch {
    // Отказ уже прошёл страж границы и `.finally`-юниты в обёртке
    // завершения — транспорту остаётся сделать ответ честным
    res.destroy();
    return;
  }

  if (!res.destroyed && !res.writableEnded) {
    res.end();
  }
}

/**
 * SSE-framing открытой подписки.
 *
 * Mid-stream отказ уходит именованным событием `error` — SSE это
 * позволяет, и клиентская сторона стандартно умеет читать именованные
 * события, — после чего соединение закрывается.
 */
async function writeSse(
  res: ServerResponse,
  source: AsyncIterable<unknown>,
  options: SendOptions,
): Promise<void> {
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders();

  const period =
    options.sse?.heartbeat ?? options.heartbeat ?? DEFAULT_SSE_HEARTBEAT;

  // Heartbeat — комментарий: не элемент потока, в счётчики и лимиты не
  // входит
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
 * Отправляет ResponseContext в ServerResponse.
 *
 * Framing выбирается **по объявленной форме** `output`, а не по типу
 * возвращённого значения: `stream` → NDJSON, `events` → SSE, остальное →
 * JSON. Одинаковая сериализация любого `AsyncIterable` независимо от формы
 * больше не применяется.
 */
export async function sendResponse(
  res: ServerResponse,
  response: ResponseContext,
  options: SendOptions = {},
): Promise<void> {
  res.statusCode = parseStatus(response.status);

  if (response.headers) {
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
  }

  const kind = options.kind ?? 'value';

  if (
    response.isSuccess &&
    (kind === 'stream' || kind === 'events') &&
    isAsyncIterable(response.value)
  ) {
    await (kind === 'events'
      ? writeSse(res, response.value, options)
      : writeNdjson(res, response.value, options));
    return;
  }

  // Если value === null - пустой ответ
  if (response.value === null) {
    res.end();
    return;
  }

  if (!res.hasHeader('content-type')) {
    res.setHeader('content-type', 'application/json');
  }

  const body = JSON.stringify(response.value);
  countBytes(options.summary, Buffer.byteLength(body ?? ''));
  res.end(body);
}
