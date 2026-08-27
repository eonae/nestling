import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { DEFAULT_SSE_HEARTBEAT, sendResponse } from './adapter.js';
import {
  assemblePayload,
  bindingNeedsBody,
  httpBindingOf,
  readQuery,
} from './binding.js';
import { HttpConfig } from './config.js';
import {
  ChunkTooLargeError,
  JsonParseError,
  MultipartFieldError,
  PayloadTooLargeError,
} from './errors.js';
import type { MultipartResult } from './parser.js';
import {
  collectFileParts,
  parseJsonBuffer,
  parseMultipartForm,
  parseNdjson,
  readBody,
} from './parser.js';
import { HttpRouter } from './router.js';
import { HTTP_TRANSPORT_NAME, HttpTransport$ } from './token.js';

import type { ConfigProjection } from '@nestling/config';
import type {
  FactoryProviderWithDeps,
  InjectionToken,
} from '@nestling/container';
import { factoryProvider } from '@nestling/container';
import type {
  AnyInput,
  EndpointMeta,
  Raw,
  StreamSummary,
  TransportCapabilities,
  UnknownFailInfo,
} from '@nestling/pipeline';
import {
  assertFormsSupported,
  bindInputStream,
  ClientDisconnectedError,
  describeForm,
  isFail,
  makeEmptyContext,
  parsePayload,
  SchemaValidationError,
  TransportClosingError,
  ValidationFailed,
} from '@nestling/pipeline';
import type { Dispatch, ITransport } from '@nestling/transport';

/**
 * Лимит размера буферизуемого тела запроса по умолчанию (1 MiB).
 */
const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;

/** Проекция конфиг-секции транспорта — то, что инжектится в фабрику */
type HttpConfigValues = ConfigProjection<typeof HttpConfig>;

/**
 * Таймаут дренажа соединений при graceful close по умолчанию (10s).
 */
const DEFAULT_CLOSE_TIMEOUT = 10_000;

/**
 * Опции для HTTP транспорта
 */
export interface HttpTransportOptions {
  port?: number;
  host?: string;

  /**
   * Лимит размера буферизуемого тела запроса в байтах (JSON, raw, text),
   * размера файла в multipart и длины строки NDJSON. По умолчанию 1 MiB.
   * `0` отключает лимит.
   */
  maxBodySize?: number;

  /**
   * Раскрывать ли клиенту детали необработанных (не `Fail`) ошибок:
   * `error.message` и `stack`. По умолчанию `false` — уходит только
   * generic-сообщение. Включать только в доверенном окружении (dev).
   */
  exposeErrorDetails?: boolean;

  /**
   * Диагностический хук стража границы: получает оригинал отказа,
   * снятого нормализацией в `UnknownError`. Не задан — рантайм пишет в
   * `console.error`.
   */
  onUnknownFail?: (info: UnknownFailInfo) => void;

  /** `server.requestTimeout` (мс). Не задан — дефолт Node. */
  requestTimeout?: number;

  /** `server.headersTimeout` (мс). Не задан — дефолт Node. */
  headersTimeout?: number;

  /** `server.keepAliveTimeout` (мс). Не задан — дефолт Node. */
  keepAliveTimeout?: number;

  /**
   * Таймаут дренажа активных соединений при `close()` (мс).
   * По истечении оставшиеся соединения закрываются принудительно.
   * По умолчанию 10s.
   */
  closeTimeout?: number;

  /**
   * Период heartbeat-комментариев SSE по умолчанию (мс). `0` отключает.
   * Декларация может переопределить его секцией `sse: { heartbeat }`.
   * По умолчанию 15s.
   */
  sseHeartbeat?: number;
}

/**
 * Формы io, которые умеет HTTP.
 *
 * `events` во входе нет: клиент, льющий SSE, — кандидат для
 * WebSocket-транспорта, а не для этого. `multipart` в выходе нет:
 * форма input-only по построению.
 */
const HTTP_CAPABILITIES: TransportCapabilities = {
  input: new Set(['value', 'stream', 'multipart']),
  output: new Set(['value', 'stream', 'events']),
};

/**
 * HTTP транспорт.
 *
 * Переводчик провода в значения и обратно: роутит, парсит вход по
 * io-декларации и bind-карте, строит контекст и отдаёт его `dispatch.call`.
 * Своей копии исполнения ручки у транспорта нет — ни ветки с пайплайном,
 * ни без него.
 */
export class HttpTransport implements ITransport {
  /**
   * Способности транспорта — данные, а не конвенция: их читает
   * `assertFormsSupported` до приёма первого запроса.
   */
  readonly capabilities: TransportCapabilities = HTTP_CAPABILITIES;

  private readonly router: HttpRouter;
  private server?: Server;

  /** Диспетчер, полученный в `serve`: до go-live исполнять нечего */
  private dispatch?: Dispatch;

  /** Фактический адрес после go-live; `null` до `serve` и после `close()` */
  private listening?: { host: string; port: number };

  /**
   * Transport-level канал отмены: взводится в `close()` и через
   * `AbortSignal.any` доставляет отмену всем in-flight запросам.
   */
  private closeController?: AbortController;

  /** Резолвнутый лимит тела: `0` = без лимита. */
  private readonly maxBodySize: number;

  /** Резолвнутая политика раскрытия деталей ошибок. */
  private readonly exposeErrorDetails: boolean;

  /** Резолвнутый период heartbeat SSE: `0` = без heartbeat. */
  private readonly sseHeartbeat: number;

  constructor(private readonly options: HttpTransportOptions = {}) {
    this.router = new HttpRouter();
    this.maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
    this.exposeErrorDetails = options.exposeErrorDetails ?? false;
    this.sseHeartbeat = options.sseHeartbeat ?? DEFAULT_SSE_HEARTBEAT;
  }

  /**
   * Выводит транспорт в эфир.
   *
   * Единственный вход: маршруты приезжают проекциями в `dispatch`, ручку
   * исполняет `dispatch.call`. Формы io сверяются со способностями
   * транспорта **до** открытия сокета — на standalone-пути это та же
   * проверка и тот же текст ошибки, что делает `App` на фазе ASSEMBLE.
   *
   * @param dispatch - Маршруты этого транспорта и исполнение ручки
   * @param signal - Канал остановки (`App` взводит его первым делом
   * на SHUTDOWN)
   */
  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    if (this.server) {
      throw new Error('Server is already listening');
    }

    for (const route of dispatch.routes) {
      assertFormsSupported(route, this.capabilities);
      this.router.route(route);
    }

    this.dispatch = dispatch;

    const listenPort = this.options.port ?? 3000;
    const listenHost = this.options.host ?? '0.0.0.0';

    this.closeController = new AbortController();

    // Внешний сигнал — второй канал остановки рядом с `close()`: его взвод
    // означает «новых запросов не принимаем, in-flight отменяем».
    signal.addEventListener('abort', () => void this.close(), { once: true });

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handle(req, res).catch(() => {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end('Internal Server Error');
          }
        });
      });

      // Таймауты node:http настраиваются, только если заданы явно —
      // иначе сохраняются разумные дефолты Node.
      if (this.options.requestTimeout !== undefined) {
        this.server.requestTimeout = this.options.requestTimeout;
      }
      if (this.options.headersTimeout !== undefined) {
        this.server.headersTimeout = this.options.headersTimeout;
      }
      if (this.options.keepAliveTimeout !== undefined) {
        this.server.keepAliveTimeout = this.options.keepAliveTimeout;
      }

      this.server.listen(listenPort, listenHost, () => {
        // Фактический адрес известен только теперь: при `port: 0` его
        // выбирает ядро ОС
        const address = this.server?.address();
        this.listening =
          address && typeof address === 'object'
            ? { host: address.address, port: address.port }
            : { host: listenHost, port: listenPort };

        resolve();
      });

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Фактический адрес транспорта после go-live.
   *
   * `null` до `serve` и после `close()`. Нужен всем, кто поднимается на
   * порту `0` — прежде всего интеграционным тестам: аргументов у `serve`,
   * кроме `dispatch` и `signal`, нет.
   */
  address(): { host: string; port: number } | null {
    return this.listening ?? null;
  }

  /**
   * Останавливает HTTP сервер с дренажом соединений.
   *
   * Порядок: взводим сигналы всех in-flight запросов (кооперативное
   * завершение — основной механизм дренажа) → перестаём принимать новые
   * соединения (`server.close`) → сразу закрываем простаивающие keep-alive
   * (`closeIdleConnections`) → ждём завершения активных запросов до
   * `closeTimeout` → принудительно закрываем оставшиеся
   * (`closeAllConnections`). Гарантирует завершение за конечное время
   * даже при живых keep-alive соединениях.
   */
  async close(options: { timeout?: number } = {}): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    this.listening = undefined;
    this.dispatch = undefined;

    // Кооперативная отмена in-flight запросов: AbortSignal.any доставит
    // её каждому meta.signal без обхода реестра контроллеров.
    this.closeController?.abort(new TransportClosingError());
    this.closeController = undefined;

    const closeTimeout =
      options.timeout ?? this.options.closeTimeout ?? DEFAULT_CLOSE_TIMEOUT;

    return new Promise((resolve, reject) => {
      // Активные in-flight запросы дренируем до closeTimeout, затем рубим.
      // Таймер не должен держать процесс живым.
      const timer = setTimeout(() => {
        server.closeAllConnections();
      }, closeTimeout);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      // Keep-alive соединение, освободившееся уже после начала close()
      // (запрос дорешался — в т.ч. кооперативно по сигналу), Node сам
      // не закрывает: без периодической зачистки дренаж ждал бы
      // keep-alive таймаута клиента.
      const idleSweep = setInterval(() => {
        server.closeIdleConnections();
      }, 100);
      if (typeof idleSweep.unref === 'function') {
        idleSweep.unref();
      }

      // server.close ждёт завершения всех соединений; колбэк — когда закрылись
      server.close((error) => {
        clearTimeout(timer);
        clearInterval(idleSweep);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });

      // Простаивающие keep-alive соединения закрываем немедленно, иначе
      // server.close ждал бы их таймаута со стороны клиента.
      server.closeIdleConnections();
    });
  }

  /**
   * Обрабатывает HTTP запрос (внутренний метод)
   */
  private async handle(
    nativeReq: IncomingMessage,
    nativeRes: ServerResponse,
  ): Promise<void> {
    // Объявляем переменные выше try блока, чтобы они были доступны в catch
    // для дренажа непрочитанных файловых потоков
    let multipart: MultipartResult | undefined;
    let payload: unknown;

    // Стартовый input контекста: пуст, если декларация не просила ни
    // `rawBody`, ни реконнекта SSE
    let startInput: AnyInput | undefined;

    // Байты входа: до создания контекста копятся локально, после —
    // дописываются прямо в живой `summary`
    let summary: StreamSummary | undefined;
    let bufferedBytesIn = 0;
    const addBytesIn = (bytes: number): void => {
      if (summary) {
        summary.bytesIn = (summary.bytesIn ?? 0) + bytes;
      } else {
        bufferedBytesIn += bytes;
      }
    };

    // Сигнал отмены запроса: per-request контроллер (дисконнект клиента)
    // + transport-level канал (graceful close), composed через AbortSignal.any
    const requestController = new AbortController();
    const signal = this.closeController
      ? AbortSignal.any([requestController.signal, this.closeController.signal])
      : requestController.signal;

    // 'close' на response приходит и после штатного завершения ответа,
    // поэтому дисконнектом считаем только недописанный ответ
    nativeRes.on('close', () => {
      if (!nativeRes.writableFinished) {
        requestController.abort(new ClientDisconnectedError());
      }
    });

    try {
      // Находим маршрут
      const route = this.router.find(nativeReq);
      const dispatch = this.dispatch;
      if (!route || !dispatch) {
        nativeRes.statusCode = 404;
        nativeRes.end('Not Found');
        return;
      }

      // Парсим URL для query параметров
      const url = new URL(
        nativeReq.url || '/',
        `http://${nativeReq.headers.host || 'localhost'}`,
      );

      // Bind-карта декларации: единственный источник правды о том, где
      // живёт каждое поле. Декларация от kernel-примитива карты не несёт —
      // тогда считается тот же канон без пометок из `pattern`.
      const binding = httpBindingOf(route.declaration);
      const query = readQuery(url.searchParams, binding.fields);

      // Форма input определяет, как читается тело
      const inputForm = describeForm(route.declaration.input);
      const outputForm = describeForm(route.declaration.output);

      // Сырой источник потокового входа: обернём его ядром, как только
      // появится контекст (счётчики живут в нём)
      let streamSource: AsyncIterable<unknown> | undefined;

      switch (inputForm.kind) {
        case 'stream':
        case 'events': {
          // Поэлементной валидации здесь нет: её делает `bindInputStream`
          streamSource = parseNdjson(nativeReq, this.maxBodySize, addBytesIn);
          break;
        }
        case 'multipart': {
          multipart = await parseMultipartForm(
            nativeReq,
            inputForm.files ?? {},
            this.maxBodySize,
          );

          // Поля формы играют роль источника «остальное»: эта форма
          // body-ориентирована по построению. Path-параметры и помеченные
          // query-поля подмешиваются к ним до валидации схемой.
          const fields = assemblePayload(binding, {
            query,
            body: multipart.fields,
            params: route.params,
            rest: 'body',
          });

          payload = {
            fields: inputForm.fields
              ? parsePayload(inputForm.fields, {
                  payload: fields as Record<string, unknown>,
                  metadata: {},
                })
              : fields,
            files: multipart.files,
          };
          break;
        }
        default: {
          if (inputForm.leaf === 'binary' || inputForm.leaf === 'text') {
            // Байты читаются один раз: они же уходят в стартовый контекст
            const raw = await readBody(nativeReq, this.maxBodySize);
            addBytesIn(raw.length);
            if (binding.rawBody) {
              startInput = { rawBody: raw };
            }
            payload = inputForm.leaf === 'binary' ? raw : raw.toString();
            break;
          }

          let body: unknown;

          if (binding.rawBody) {
            // Одно чтение: байты в стартовый контекст, значение парсится
            // из того же буфера
            const raw = await readBody(nativeReq, this.maxBodySize);
            addBytesIn(raw.length);
            startInput = { rawBody: raw };
            body = parseJsonBuffer(raw);
          } else if (inputForm.leaf && bindingNeedsBody(binding)) {
            // Тело читается только тогда, когда его требует карта: у GET
            // без body-пометок оно не буферизуется вовсе
            const raw = await readBody(nativeReq, this.maxBodySize);
            addBytesIn(raw.length);
            body = parseJsonBuffer(raw);
          }

          payload = assemblePayload(binding, {
            query,
            body,
            params: route.params,
          });
        }
      }

      // Реконнект SSE: заголовок доезжает тем же механизмом, что `rawBody`
      if (outputForm.kind === 'events') {
        const lastEventId = nativeReq.headers['last-event-id'];
        if (typeof lastEventId === 'string') {
          startInput = { ...startInput, lastEventId };
        }
      }

      const raw: Raw = {
        transport: HTTP_TRANSPORT_NAME,
        pattern: `${nativeReq.method || 'GET'} ${url.pathname}`,
        payload,
        attributes: nativeReq.headers as Record<string, string>,
      };

      const endpointMeta: EndpointMeta = {
        transport: HTTP_TRANSPORT_NAME,
        pattern: route.declaration.pattern,
        input: route.declaration.input,
        output: route.declaration.output,
        // Объявленные отказы доезжают до стража только так: декларация →
        // транспорт → контекст, без глобального реестра.
        errors: route.declaration.errors,
      };

      const ctx = makeEmptyContext(raw, endpointMeta, signal, startInput);
      summary = ctx.summary;
      if (bufferedBytesIn > 0) {
        summary.bytesIn = bufferedBytesIn;
      }

      if (streamSource) {
        // Обёртка ядра доступна только теперь: счётчики и сигнал живут в
        // контексте, а сам поток ленив — до первого `for await` в хендлере
        // не потреблён ни один элемент
        raw.payload = bindInputStream(inputForm, streamSource, ctx);
      }

      const send = (response: Parameters<typeof sendResponse>[1]) =>
        sendResponse(nativeRes, response, {
          kind: outputForm.kind,
          sse: binding.sse,
          heartbeat: this.sseHeartbeat,
          summary: ctx.summary,
          signal,
        });

      // Исполнение ручки — в ядре: выбор ветки «с пайплайном / без него»
      // и её выполнение одинаковы для всех транспортов. Транспорту
      // остаётся сантехника ответа.
      const responseContext = await dispatch.call(
        route.declaration.pattern,
        ctx,
        {
          exposeErrorDetails: this.exposeErrorDetails,
          onUnknownFail: this.options.onUnknownFail,
        },
      );

      await send(responseContext);
      this.drainFileStreams(multipart);
    } catch (error) {
      this.drainFileStreams(multipart);
      this.sendError(nativeRes, error);
    }
  }

  /**
   * Отправляет ошибку парсинга/роутинга/fallback-ветки с корректным статусом.
   *
   * Классификация (D2):
   * - `JsonParseError`, `MultipartFieldError`, `SchemaValidationError` → 400
   * - `PayloadTooLargeError`, `ChunkTooLargeError` → 413
   * - остальное → 500, детали скрыты, если не включён `exposeErrorDetails`
   *
   * Ошибки клиента (400/413) содержат безопасное сообщение, описывающее
   * некорректный ввод; внутренние детали не раскрываются.
   *
   * Через страж контракта эта ветка не проходит (пайплайна тут нет),
   * поэтому тела ошибок парсинга и лимитов остаются как есть. Исключение —
   * отказ валидации: kernel-код `VALIDATION_FAILED` проставляется на обоих
   * путях, чтобы один концерн не отвечал двумя разными телами.
   */
  private sendError(res: ServerResponse, error: unknown): void {
    if (res.headersSent) {
      return;
    }

    // Fail из fallback-ветки (endpoint без pipeline) — осознанная ошибка автора:
    // статус, код и детали сохраняем (как это делает pipeline через
    // errorToResponse).
    if (isFail(error)) {
      void sendResponse(res, {
        isSuccess: false,
        status: error.status ?? 'INTERNAL_ERROR',
        value: {
          error: error.message ?? 'Error',
          ...(error.code === undefined ? {} : { code: error.code }),
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }

    let status = 500;
    const body: {
      error: string;
      code?: string;
      details?: unknown;
      stack?: string;
    } = {
      error: 'Internal server error',
    };

    if (
      error instanceof JsonParseError ||
      error instanceof MultipartFieldError
    ) {
      status = 400;
      body.error = error.message;
    } else if (error instanceof SchemaValidationError) {
      status = 400;
      body.error = 'Validation failed';
      body.code = ValidationFailed.code;
      body.details = error.issues;
    } else if (
      error instanceof PayloadTooLargeError ||
      error instanceof ChunkTooLargeError
    ) {
      status = 413;
      body.error = 'Payload too large';
    } else if (this.exposeErrorDetails) {
      body.error = error instanceof Error ? error.message : 'Unknown error';
      if (error instanceof Error && error.stack) {
        body.stack = error.stack;
      }
    }

    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  }

  /**
   * Дренирует непрочитанные файловые потоки: хендлер вправе не читать
   * файл, а незакрытый поток удерживал бы память до GC.
   */
  private drainFileStreams(result: MultipartResult | undefined): void {
    if (!result) {
      return;
    }

    try {
      for (const file of collectFileParts(result)) {
        const stream = file.stream as NodeJS.ReadableStream & {
          readableEnded?: boolean;
          resume?: () => void;
        };

        if (stream && !stream.readableEnded && stream.resume) {
          stream.resume();
        }
      }
    } catch {
      // Игнорируем ошибки дренажа
    }
  }
}

/**
 * Фабрика провайдера HTTP-транспорта.
 *
 * Возвращает **провайдер**, а не инстанс: транспорт — обычный узел графа,
 * его зависимости инжектит контейнер, а lifecycle гоняется наравне с
 * прочими. `assemble({ transports: [http()] })` — сахар регистрации, и
 * ровно тот же провайдер легально объявить в `providers:` infra-модуля
 * фичи.
 *
 * Приоритет значений: явные опции фабрики > конфиг (`HTTP_PORT`,
 * `HTTP_HOST`) > дефолт транспорта.
 *
 * @example
 * ```typescript
 * await assemble({ modules: [UsersModule], transports: [http()] }).run();
 * await assemble({ modules: [UsersModule], transports: [http({ port: 3000 })] }).run();
 * ```
 */
export const http = (
  options: HttpTransportOptions = {},
): FactoryProviderWithDeps<ITransport, [InjectionToken<HttpConfigValues>]> =>
  factoryProvider(
    HttpTransport$,
    (config: HttpConfigValues) =>
      new HttpTransport({
        port: config.port,
        host: config.host,
        // Явные опции сильнее конфига: спред идёт последним
        ...options,
      }),
    [HttpConfig as unknown as InjectionToken<HttpConfigValues>],
  );
