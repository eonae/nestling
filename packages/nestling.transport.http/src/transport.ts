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
import type { InjectionToken } from '@nestling/container';
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
  BadRequest,
  bindInputStream,
  ClientDisconnectedError,
  describeForm,
  InternalError,
  makeEmptyContext,
  PayloadTooLarge,
  TransportClosingError,
} from '@nestling/pipeline';
import type {
  Dispatch,
  ITransport,
  TransportDeclaration,
} from '@nestling/transport';
import {
  DEFAULT_INSTANCE,
  makeTransportDeclaration,
} from '@nestling/transport';

/** Лимит размера буферизуемого тела запроса по умолчанию (1 MiB) */
const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;

/** Значения конфиг-секции транспорта, которые получает фабрика */
type HttpConfigValues = ConfigProjection<typeof HttpConfig>;

/** Сколько `close()` ждёт активные соединения по умолчанию (10 с) */
const DEFAULT_CLOSE_TIMEOUT = 10_000;

/** Опции HTTP-транспорта */
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
   * Отдавать ли клиенту детали необработанных ошибок (не `Fail`):
   * `error.message` и `stack`. По умолчанию `false`: уходит только общее
   * сообщение. Включайте только в доверенном окружении.
   */
  exposeErrorDetails?: boolean;

  /**
   * Хук для незадекларированных отказов: получает оригинал отказа,
   * который проверка `errors` заменила на `InternalError`. Не задан —
   * рантайм пишет в `console.error`.
   */
  onUnknownFail?: (info: UnknownFailInfo) => void;

  /** `server.requestTimeout` (мс). Не задан — дефолт Node. */
  requestTimeout?: number;

  /** `server.headersTimeout` (мс). Не задан — дефолт Node. */
  headersTimeout?: number;

  /** `server.keepAliveTimeout` (мс). Не задан — дефолт Node. */
  keepAliveTimeout?: number;

  /**
   * Сколько ждать завершения активных соединений при `close()` (мс).
   * По истечении оставшиеся соединения закрываются принудительно.
   * По умолчанию 10 с.
   */
  closeTimeout?: number;

  /**
   * Период heartbeat-комментариев SSE по умолчанию (мс). `0` отключает.
   * Декларация может переопределить его полем `sse: { heartbeat }`.
   * По умолчанию 15 с.
   */
  sseHeartbeat?: number;
}

/**
 * Формы io, которые поддерживает HTTP-транспорт.
 *
 * `events` на входе нет: клиентский поток событий — задача
 * WebSocket-транспорта. `multipart` на выходе нет: эта форма только
 * входная.
 *
 * Это же значение отдаёт `HttpTransport.capabilities`. Транспорт поверх
 * другого HTTP-сервера объявляет свои формы им, а не повторяет литерал:
 * копия разошлась бы с пакетом при следующей правке.
 */
export const HTTP_CAPABILITIES: TransportCapabilities = {
  input: new Set(['value', 'stream', 'multipart']),
  output: new Set(['value', 'stream', 'events']),
};

/**
 * HTTP-транспорт.
 *
 * Переводит запросы в значения и обратно: находит маршрут, разбирает вход
 * по форме io и bind-карте, строит контекст и передаёт его `dispatch.call`.
 * Endpoint исполняет ядро; своей логики исполнения у транспорта нет.
 */
export class HttpTransport implements ITransport {
  /**
   * Поддерживаемые формы io. Их читает `assertFormsSupported` до приёма
   * первого запроса.
   */
  readonly capabilities: TransportCapabilities = HTTP_CAPABILITIES;

  private readonly router: HttpRouter;
  private server?: Server;

  /** Диспетчер из `serve`; до вызова `serve` исполнять нечего */
  private dispatch?: Dispatch;

  /** Фактический адрес; не задан до `serve` и после `close()` */
  private listening?: { host: string; port: number };

  /** Контроллер остановки транспорта: взводится первым шагом `close()` */
  private closeController?: AbortController;

  /**
   * Контроллеры выполняющихся запросов. `handle` добавляет контроллер,
   * событие `'close'` ответа удаляет, `close()` взводит каждый оставшийся.
   *
   * Реестр вместо композитного сигнала на запрос: `AbortSignal.any` стоит
   * около 2 µs на вызов и копит `WeakRef` на сигнале остановки
   * (ideas.md [2026-09-05]).
   */
  private readonly active = new Set<AbortController>();

  /** Лимит тела с учётом дефолта; `0` — без лимита */
  private readonly maxBodySize: number;

  /** Раскрывать ли детали ошибок, с учётом дефолта */
  private readonly exposeErrorDetails: boolean;

  /** Период heartbeat SSE с учётом дефолта; `0` — без heartbeat */
  private readonly sseHeartbeat: number;

  constructor(private readonly options: HttpTransportOptions = {}) {
    this.router = new HttpRouter();
    this.maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
    this.exposeErrorDetails = options.exposeErrorDetails ?? false;
    this.sseHeartbeat = options.sseHeartbeat ?? DEFAULT_SSE_HEARTBEAT;
  }

  /**
   * Начинает принимать запросы.
   *
   * Маршруты берутся из `dispatch.routes`, endpoint исполняет
   * `dispatch.call`. Формы io сверяются с поддерживаемыми до открытия
   * сокета: без `App` это та же проверка с тем же текстом ошибки, что на
   * фазе ASSEMBLE.
   *
   * @param dispatch - Маршруты этого транспорта и функция исполнения
   * @param signal - Сигнал остановки; `App` подаёт его первым шагом
   * SHUTDOWN
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

    // Внешний сигнал останавливает транспорт так же, как `close()`
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

      // Таймауты node:http меняются только при явных опциях; иначе
      // остаются дефолты Node
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
   * Возвращает фактический адрес транспорта.
   *
   * `null` до `serve` и после `close()`. Нужен при `port: 0`, когда порт
   * выбирает ОС, например в интеграционных тестах.
   */
  address(): { host: string; port: number } | null {
    return this.listening ?? null;
  }

  /**
   * Останавливает сервер, дав активным запросам завершиться.
   *
   * Порядок: подаёт сигнал отмены всем выполняющимся запросам, перестаёт
   * принимать новые соединения (`server.close`), сразу закрывает
   * простаивающие keep-alive (`closeIdleConnections`), ждёт завершения
   * активных запросов до `closeTimeout` и закрывает оставшиеся
   * принудительно (`closeAllConnections`). Завершается за конечное время
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

    // Сначала контроллер остановки, затем каждый запрос в полёте: их
    // `meta.signal` взведён до начала дренажа
    const reason = new TransportClosingError();
    this.closeController?.abort(reason);
    this.closeController = undefined;
    for (const controller of this.active) {
      controller.abort(reason);
    }
    this.active.clear();

    const closeTimeout =
      options.timeout ?? this.options.closeTimeout ?? DEFAULT_CLOSE_TIMEOUT;

    return new Promise((resolve, reject) => {
      // Активные запросы ждём до closeTimeout, затем закрываем принудительно.
      // Таймер не должен держать процесс живым
      const timer = setTimeout(() => {
        server.closeAllConnections();
      }, closeTimeout);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      // Keep-alive соединение, освободившееся после начала close(), Node сам
      // не закрывает: без периодической зачистки ожидание длилось бы до
      // keep-alive таймаута клиента
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

  /** Обрабатывает один HTTP-запрос */
  private async handle(
    nativeReq: IncomingMessage,
    nativeRes: ServerResponse,
  ): Promise<void> {
    // Переменные объявлены до try, чтобы catch мог дочитать непрочитанные
    // файловые потоки
    let multipart: MultipartResult | undefined;
    let payload: unknown;

    // Стартовый контекст: пуст, если декларация не просила `rawBody` и не
    // отдаёт SSE
    let startInput: AnyInput | undefined;

    // Байты входа копятся локально, пока нет контекста, затем пишутся в
    // `summary`
    let summary: StreamSummary | undefined;
    let bufferedBytesIn = 0;
    const addBytesIn = (bytes: number): void => {
      if (summary) {
        summary.bytesIn = (summary.bytesIn ?? 0) + bytes;
      } else {
        bufferedBytesIn += bytes;
      }
    };

    // Сигнал запроса: собственный контроллер. Дисконнект клиента взводит
    // его здесь, остановка транспорта — из `close()` через реестр
    const requestController = new AbortController();
    const { signal } = requestController;
    this.active.add(requestController);

    // 'close' на response приходит и после штатного завершения ответа,
    // поэтому дисконнектом считаем только недописанный ответ
    nativeRes.on('close', () => {
      this.active.delete(requestController);
      if (!nativeRes.writableFinished) {
        requestController.abort(new ClientDisconnectedError());
      }
    });

    try {
      const route = this.router.find(nativeReq);
      const dispatch = this.dispatch;
      if (!route || !dispatch) {
        nativeRes.statusCode = 404;
        nativeRes.end('Not Found');
        return;
      }

      const url = new URL(
        nativeReq.url || '/',
        `http://${nativeReq.headers.host || 'localhost'}`,
      );

      // Bind-карта говорит, откуда читать каждое поле. Декларация из
      // `makeEndpoint` карты не несёт: тогда карта вычисляется из `pattern`
      // без пометок
      const binding = httpBindingOf(route.declaration);
      const query = readQuery(url.searchParams, binding.fields);

      // Форма input определяет, как читается тело
      const inputForm = describeForm(route.declaration.input);
      const outputForm = describeForm(route.declaration.output);

      // Потоковый вход оборачивается ядром только после создания контекста:
      // счётчики живут в нём
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

          // Поля формы играют роль источника «остальное». Path-параметры и
          // помеченные query-поля добавляются к ним до валидации схемой
          const fields = assemblePayload(binding, {
            query,
            body: multipart.fields,
            params: route.params,
            rest: 'body',
          });

          // Схемой `fields` проверяет рантайм пайплайна: у транспорта
          // своей ветки валидации нет, иначе `app.call` и HTTP разошлись бы
          payload = { fields, files: multipart.files };
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

      // Реконнект SSE: заголовок попадает в стартовый контекст так же, как
      // `rawBody`
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
        // Объявленные отказы попадают в проверку `errors` только через
        // контекст: глобального реестра нет
        errors: route.declaration.errors,
      };

      const ctx = makeEmptyContext(raw, endpointMeta, signal, startInput);
      summary = ctx.summary;
      if (bufferedBytesIn > 0) {
        summary.bytesIn = bufferedBytesIn;
      }

      if (streamSource) {
        // Поток ленив: до первого `for await` в хендлере ни один элемент не
        // прочитан
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

      // Endpoint исполняет ядро одинаково для всех транспортов; транспорту
      // остаётся отправить ответ
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
   * Отправляет ошибку разбора запроса или роутинга с подходящим статусом.
   *
   * Статусы и коды:
   * - `JsonParseError`, `MultipartFieldError` — 400, `bad_request`;
   * - `PayloadTooLargeError` — 413, `payload_too_large`;
   * - остальное — 500, `internal_error`; детали уходят только при
   *   `exposeErrorDetails`.
   *
   * Тела ошибок 400 и 413 описывают некорректный ввод и не раскрывают
   * внутреннее состояние сервера. Исход самого endpoint'а сюда не
   * попадает: `dispatch.call` возвращает готовый контекст ответа для
   * любого исхода, включая отказ проверки входа.
   */
  private sendError(res: ServerResponse, error: unknown): void {
    if (res.headersSent) {
      return;
    }

    let status = 500;
    const body: {
      error: string;
      code: string;
      details?: unknown;
      stack?: string;
    } = {
      error: 'Internal server error',
      code: InternalError.code,
    };

    if (
      error instanceof JsonParseError ||
      error instanceof MultipartFieldError
    ) {
      status = 400;
      body.error = error.message;
      body.code = BadRequest.code;
      body.details = [{ message: error.message }];
    } else if (error instanceof PayloadTooLargeError) {
      status = 413;
      body.error = 'Payload too large';
      body.code = PayloadTooLarge.code;
      body.details = { limit: error.limit };
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
   * Дочитывает непрочитанные файловые потоки: хендлер может не читать
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
      // Ошибки дочитывания не важны: ответ уже отправлен
    }
  }
}

/**
 * Объявляет экземпляр HTTP-транспорта.
 *
 * Возвращает объявление, а не экземпляр: транспорт — обычный узел графа,
 * его зависимости инжектит контейнер. Экземпляров может быть несколько;
 * каждый получает своё имя, а декларация выбирает свой через `on:`.
 *
 * Приоритет значений: явные опции фабрики, затем конфиг (`HTTP_PORT`,
 * `HTTP_HOST`), затем дефолт транспорта.
 *
 * @example
 * ```typescript
 * await assemble({ features: [Users], transports: [http()] }).run();
 *
 * await assemble({
 *   features: [Users, Ops],
 *   transports: [http({ port: 3000 }), http({ name: 'admin', port: 3001 })],
 * }).run();
 * ```
 */
export const http = <const Name extends string = typeof DEFAULT_INSTANCE>(
  options: HttpTransportOptions & { readonly name?: Name } = {},
): TransportDeclaration<Name> => {
  const { name = DEFAULT_INSTANCE as Name, ...transportOptions } = options;
  const token = HttpTransport$(name);

  return makeTransportDeclaration({
    name,
    token,
    provider: factoryProvider(
      token,
      (config: HttpConfigValues) =>
        new HttpTransport({
          port: config.port,
          host: config.host,
          // Явные опции сильнее конфига: спред идёт последним
          ...transportOptions,
        }),
      [HttpConfig as unknown as InjectionToken<HttpConfigValues>],
    ),
  });
};
