import type { IncomingMessage, ServerResponse } from 'node:http';

import { DEFAULT_SSE_HEARTBEAT, sendResponse } from './adapter.js';
import { assemblePayload, readQuery } from './binding.js';
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
import type { HttpRequest } from './request.js';
import { HttpRouter } from './router.js';
import type { HttpServer } from './server.js';
import { httpServer, HttpServer$ } from './server.js';
import { HTTP_TRANSPORT_NAME, HttpTransport$ } from './token.js';

import type {
  AnyInput,
  Dispatch,
  EndpointMeta,
  ITransport,
  Raw,
  ServerDeclaration,
  StreamSummary,
  TransportCapabilities,
  TransportDeclaration,
} from '@nestling/app';
import {
  assertFormsSupported,
  BadRequest,
  bindInputStream,
  ClientDisconnectedError,
  DEFAULT_INSTANCE,
  InternalError,
  makeEmptyContext,
  makeTransportDeclaration,
  PayloadTooLarge,
  TransportClosingError,
} from '@nestling/app';
import { factoryProvider } from '@nestling/container';

/** Лимит размера буферизуемого тела запроса по умолчанию (1 MiB) */
const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;

/** Опции HTTP-транспорта */
export interface HttpTransportOptions {
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
 * Одна константа на пакет и два её потребителя: объявление `http()` — его
 * читает проверка форм на фазе ASSEMBLE — и `serve`, который сверяет
 * маршруты на standalone-пути. Транспорт поверх другого HTTP-сервера
 * объявляет свои формы ею же, а не повторяет литерал: копия разошлась бы с
 * пакетом при следующей правке.
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
 *
 * Сокет транспорту не принадлежит: его держит `HttpServer`, а транспорт
 * присоединяет к нему обработчик в `serve`. Поэтому `listen` и `address()`
 * здесь отсутствуют, а несколько транспортов работают на одном порту.
 */
export class HttpTransport implements ITransport {
  private readonly router: HttpRouter;

  /** Диспетчер из `serve`; до вызова `serve` исполнять нечего */
  private dispatch?: Dispatch;

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

  /**
   * @param server - Сервер, к которому транспорт присоединяет обработчик;
   * его же он делит с другими транспортами того же сокета
   * @param options - Опции разбора и ответа; адреса среди них нет
   */
  constructor(
    private readonly server: HttpServer,
    private readonly options: HttpTransportOptions = {},
  ) {
    this.router = new HttpRouter();
    this.maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
    this.exposeErrorDetails = options.exposeErrorDetails ?? false;
    this.sseHeartbeat = options.sseHeartbeat ?? DEFAULT_SSE_HEARTBEAT;
  }

  /**
   * Присоединяет обработчик к серверу.
   *
   * Маршруты берутся из `dispatch.routes`, endpoint исполняет
   * `dispatch.call`. Формы io сверяются с поддерживаемыми здесь же: без
   * `App` это та же проверка с тем же текстом ошибки, что на фазе
   * ASSEMBLE.
   *
   * Сокет при этом не открывается: его открывает сервер следующим шагом
   * START, когда обработчики присоединили все транспорты.
   *
   * @param dispatch - Маршруты этого транспорта и функция исполнения
   * @param signal - Сигнал остановки; `App` подаёт его первым шагом
   * SHUTDOWN
   */
  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    if (this.dispatch) {
      throw new Error('Transport is already serving');
    }

    for (const route of dispatch.routes) {
      assertFormsSupported(route, HTTP_CAPABILITIES);
      this.router.route(route);
    }

    this.dispatch = dispatch;
    this.closeController = new AbortController();

    // Внешний сигнал останавливает транспорт так же, как `close()`
    signal.addEventListener('abort', () => void this.close(), { once: true });

    this.server.attach((req, res) => this.handle(req, res));
  }

  /**
   * Отменяет запросы в обработке.
   *
   * Сокета не касается: соединения дренажит сервер, и делает это раньше —
   * первым шагом SHUTDOWN. Здесь взводятся `meta.signal` всех in-flight
   * запросов, чтобы хендлеры завершились кооперативно.
   */
  async close(): Promise<void> {
    if (!this.dispatch) {
      return;
    }

    this.dispatch = undefined;

    // Сначала контроллер остановки, затем каждый запрос в полёте
    const reason = new TransportClosingError();
    this.closeController?.abort(reason);
    this.closeController = undefined;
    for (const controller of this.active) {
      controller.abort(reason);
    }
    this.active.clear();
  }

  /**
   * Обрабатывает один HTTP-запрос.
   *
   * Возвращает `false`, когда маршрут не найден: значит, запрос не этого
   * транспорта, и сервер отдаёт его следующему обработчику цепочки.
   * Ответ `404` — дело сервера, а не транспорта.
   */
  private async handle(
    nativeReq: IncomingMessage,
    nativeRes: ServerResponse,
  ): Promise<boolean> {
    // Переменные объявлены до try, чтобы catch мог дочитать непрочитанные
    // файловые потоки
    let multipart: MultipartResult | undefined;
    let payload: unknown;

    // Стартовый контекст: запрос есть всегда, `rawBody` и `lastEventId`
    // добавляют пометка декларации и форма `events`
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
      const found = this.router.find(nativeReq);
      const dispatch = this.dispatch;
      if (!found || !dispatch) {
        this.active.delete(requestController);
        return false;
      }

      // Bind-карта, формы и признаки чтения вычислены при регистрации
      // маршрута: на запрос остаётся только чтение
      const { route, params } = found;
      const { declaration, binding, inputForm, outputForm } = route;

      // Путь берётся срезом до `?`, как прислан клиентом; query
      // разбирается только когда её читает карта и она есть в запросе
      const rawUrl = nativeReq.url || '/';
      const separator = rawUrl.indexOf('?');
      const path = separator === -1 ? rawUrl : rawUrl.slice(0, separator);
      const query =
        route.readsQuery && separator !== -1
          ? readQuery(
              new URLSearchParams(rawUrl.slice(separator + 1)),
              binding.fields,
            )
          : {};

      // Запрос собирается из уже прочитанных значений: заголовки — та же
      // ссылка, что уходит в `raw.attributes`
      const http: HttpRequest = {
        method: nativeReq.method || 'GET',
        url: rawUrl,
        headers: nativeReq.headers as Record<string, string>,
        ip: nativeReq.socket.remoteAddress,
        receivedAt: Date.now(),
      };
      startInput = { http };

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
            params,
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
              startInput = { ...startInput, rawBody: raw };
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
            startInput = { ...startInput, rawBody: raw };
            body = parseJsonBuffer(raw);
          } else if (inputForm.leaf && route.needsBody) {
            // Тело читается только тогда, когда его требует карта: у GET
            // без body-пометок оно не буферизуется вовсе
            const raw = await readBody(nativeReq, this.maxBodySize);
            addBytesIn(raw.length);
            body = parseJsonBuffer(raw);
          }

          payload = assemblePayload(binding, { query, body, params });
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
        pattern: `${nativeReq.method || 'GET'} ${path}`,
        payload,
        attributes: nativeReq.headers as Record<string, string>,
      };

      const endpointMeta: EndpointMeta = {
        transport: HTTP_TRANSPORT_NAME,
        pattern: declaration.pattern,
        input: declaration.input,
        output: declaration.output,
        // Объявленные отказы попадают в проверку `errors` только через
        // контекст: глобального реестра нет
        errors: declaration.errors,
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
          redirect: binding.redirect,
          pattern: declaration.pattern,
          heartbeat: this.sseHeartbeat,
          summary: ctx.summary,
          signal,
        });

      // Endpoint исполняет ядро одинаково для всех транспортов; транспорту
      // остаётся отправить ответ
      const responseContext = await dispatch.call(declaration.pattern, ctx, {
        exposeErrorDetails: this.exposeErrorDetails,
      });

      await send(responseContext);
      this.drainFileStreams(multipart);
    } catch (error) {
      this.drainFileStreams(multipart);
      this.sendError(nativeRes, error);
    }

    return true;
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
 * Сокет транспорту не принадлежит. Без `server` фабрика объявляет
 * собственный сервер с тем же именем, что у транспорта, и корень
 * регистрирует его вместе с транспортом — поэтому `transports: [http()]`
 * работает без единого упоминания сервера. С `server` транспорт
 * присоединяется к уже объявленному: так на одном сокете работают
 * несколько транспортов. Порт и хост приходят из секции сервера
 * (`HTTP_PORT`, `HTTP_HOST`); опций адреса у транспорта нет.
 *
 * @param options - Имя экземпляра, сервер и опции разбора запроса
 * @returns Объявление транспорта для `transports:` корня
 *
 * @example Один транспорт и его сервер
 * ```typescript
 * await makeApp({ features: [Users], transports: [http()] }).assemble().run();
 * ```
 *
 * @example Публичный и админский сокеты
 * ```typescript
 * await makeApp({
 *   features: [Users, Ops],
 *   transports: [http(), http({ name: 'admin' })],
 * }).assemble().run();
 * ```
 */
export const http = <const Name extends string = typeof DEFAULT_INSTANCE>(
  options: HttpTransportOptions & {
    readonly name?: Name;

    /**
     * Сервер, на котором работает транспорт.
     *
     * Без него фабрика объявляет собственный сервер с именем транспорта.
     */
    readonly server?: ServerDeclaration;
  } = {},
): TransportDeclaration<Name> => {
  const {
    name = DEFAULT_INSTANCE as Name,
    server = httpServer({ name }),
    ...transportOptions
  } = options;
  const token = HttpTransport$(name);

  return makeTransportDeclaration({
    name,
    token,
    capabilities: HTTP_CAPABILITIES,
    server,
    provider: factoryProvider(
      token,
      (instance: HttpServer) => new HttpTransport(instance, transportOptions),
      [HttpServer$(server.name)],
    ),
  });
};
