import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { sendResponse } from './adapter.js';
import {
  ChunkTooLargeError,
  JsonParseError,
  PayloadConflictError,
  PayloadTooLargeError,
} from './errors.js';
import type { HttpEndpointMetadata } from './helpers.js';
import { mergePayload } from './merge.js';
import {
  parseFilesOnly,
  parseJson,
  parseRaw,
  parseStream,
  parseWithFiles,
  readBody,
} from './parser.js';
import { HttpRouter } from './router.js';

import type { Schema } from '@common/misc';
import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  EndpointMeta,
  IEndpoint,
  Pipeline,
  Raw,
} from '@nestling/pipeline';
import {
  analyzePayload,
  Fail,
  makeEmptyContext,
  parsePayload,
  SchemaValidationError,
} from '@nestling/pipeline';

/**
 * Лимит размера буферизуемого тела запроса по умолчанию (1 MiB).
 */
const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;

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
}

/**
 * HTTP транспорт
 *
 * Работает с новой архитектурой:
 * - Создаёт Raw и начальный контекст с пустым input
 * - Выполняет pipeline из endpoint metadata
 * - Handler получает (payload, meta)
 */
export class HttpTransport {
  private readonly router: HttpRouter;
  private server?: Server;

  /** Резолвнутый лимит тела: `0` = без лимита. */
  private readonly maxBodySize: number;

  /** Резолвнутая политика раскрытия деталей ошибок. */
  private readonly exposeErrorDetails: boolean;

  constructor(private readonly options: HttpTransportOptions = {}) {
    this.router = new HttpRouter();
    this.maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
    this.exposeErrorDetails = options.exposeErrorDetails ?? false;
  }

  /**
   * Регистрирует endpoint
   */
  registerEndpoint<
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = AnyOutput,
    P extends AnyInput = AnyInput,
  >(
    instance: IEndpoint<I, O, P>,
    metadata: HttpEndpointMetadata<I, O, P>,
  ): void {
    this.router.route({
      transport: 'http',
      pattern: metadata.pattern,
      input: metadata.input,
      output: metadata.output,
      pipeline: metadata.pipeline,
      handle: instance.handle.bind(instance),
    });
  }

  /**
   * Регистрирует маршрут через definition
   */
  route<
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = AnyOutput,
    P extends AnyInput = AnyInput,
  >(definition: EndpointDefinition<I, O, P>): void {
    this.router.route(definition);
  }

  /**
   * Alias для route() - реализация ITransport интерфейса
   */
  endpoint<
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = AnyOutput,
    P extends AnyInput = AnyInput,
  >(definition: EndpointDefinition<I, O, P>): void {
    this.route(definition);
  }

  /**
   * Запускает HTTP сервер
   */
  async listen(port?: number, host?: string): Promise<void> {
    if (this.server) {
      throw new Error('Server is already listening');
    }

    const listenPort = port ?? this.options.port ?? 3000;
    const listenHost = host ?? this.options.host ?? '0.0.0.0';

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
        resolve();
      });

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Останавливает HTTP сервер с дренажом соединений.
   *
   * Порядок: перестаём принимать новые соединения (`server.close`) →
   * сразу закрываем простаивающие keep-alive (`closeIdleConnections`) →
   * ждём завершения активных запросов до `closeTimeout` → принудительно
   * закрываем оставшиеся (`closeAllConnections`). Гарантирует завершение
   * за конечное время даже при живых keep-alive соединениях.
   */
  async close(options: { timeout?: number } = {}): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;

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

      // server.close ждёт завершения всех соединений; колбэк — когда закрылись
      server.close((error) => {
        clearTimeout(timer);
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
    // Объявляем переменные выше try блока, чтобы они были доступны в catch для cleanup
    let inputConfigType: string | undefined;
    let payload: unknown;

    try {
      // Находим маршрут
      const route = this.router.find(nativeReq);
      if (!route) {
        nativeRes.statusCode = 404;
        nativeRes.end('Not Found');
        return;
      }

      // Парсим URL для query параметров
      const url = new URL(
        nativeReq.url || '/',
        `http://${nativeReq.headers.host || 'localhost'}`,
      );

      const query: Record<string, string> = {};
      for (const [key, value] of url.searchParams.entries()) {
        query[key] = value;
      }

      // Анализируем input конфигурацию
      const inputConfig = analyzePayload(route.definition.input);
      inputConfigType = inputConfig.type;

      // Парсим входные данные согласно типу модификатора
      switch (inputConfig.type) {
        case 'stream': {
          payload = parseStream(
            nativeReq,
            inputConfig.schema as Schema,
            this.maxBodySize,
          );
          break;
        }
        case 'withFiles': {
          const result = await parseWithFiles(nativeReq, this.maxBodySize);
          const dataWithParams = mergePayload(
            result.data,
            undefined,
            route.params,
          );
          const validatedData = inputConfig.schema
            ? parsePayload(inputConfig.schema as Schema, {
                payload: dataWithParams as Record<string, unknown>,
                metadata: {},
              })
            : dataWithParams;
          payload = {
            data: validatedData,
            files: result.files,
          };
          break;
        }
        case 'files': {
          payload = await parseFilesOnly(nativeReq, this.maxBodySize);
          break;
        }
        case 'primitive': {
          if (inputConfig.primitive === 'binary') {
            payload = await parseRaw(nativeReq, this.maxBodySize);
          } else if (inputConfig.primitive === 'text') {
            const rawText = await readBody(nativeReq, this.maxBodySize);
            payload = rawText.toString();
          }
          break;
        }
        default: {
          let body: unknown;
          if (inputConfig.schema) {
            body = await parseJson(nativeReq, this.maxBodySize);
          }
          payload = mergePayload(
            body,
            Object.keys(query).length > 0 ? query : undefined,
            route.params,
          );
        }
      }

      // Получаем pipeline из endpoint metadata
      const pipeline = route.definition.pipeline as
        | Pipeline<AnyInput>
        | undefined;

      if (pipeline) {
        // Новая архитектура с pipeline
        const raw: Raw = {
          transport: 'http',
          pattern: `${nativeReq.method || 'GET'} ${url.pathname}`,
          payload,
          attributes: nativeReq.headers as Record<string, string>,
        };

        const endpointMeta: EndpointMeta = {
          transport: 'http',
          pattern: route.definition.pattern,
          input: route.definition.input,
          output: route.definition.output,
        };

        const ctx = makeEmptyContext(raw, endpointMeta);

        const responseContext = await pipeline.executeWithHandler(
          route.handler,
          ctx,
          { exposeErrorDetails: this.exposeErrorDetails },
        );

        this.cleanupFileStreams(inputConfigType, payload);
        sendResponse(nativeRes, responseContext);
      } else {
        // Fallback для endpoint'ов без pipeline (прямой вызов handler)
        // Валидируем payload если есть schema
        if (inputConfig.type === 'schema' && inputConfig.schema) {
          payload = parsePayload(inputConfig.schema as Schema, {
            payload: payload as Record<string, unknown>,
            metadata: {},
          });
        }

        // Без pipeline meta пустая
        const meta = {};

        const result = await route.handler(payload, meta);

        this.cleanupFileStreams(inputConfigType, payload);

        // Нормализуем ответ
        sendResponse(nativeRes, {
          isSuccess: true,
          status: 'OK',
          value: result,
        });
      }
    } catch (error) {
      this.cleanupFileStreams(inputConfigType, payload);
      this.sendError(nativeRes, error);
    }
  }

  /**
   * Отправляет ошибку парсинга/роутинга/fallback-ветки с корректным статусом.
   *
   * Классификация (D2):
   * - `JsonParseError`, `PayloadConflictError`, `SchemaValidationError` → 400
   * - `PayloadTooLargeError`, `ChunkTooLargeError` → 413
   * - остальное → 500, детали скрыты, если не включён `exposeErrorDetails`
   *
   * Ошибки клиента (400/413) содержат безопасное сообщение, описывающее
   * некорректный ввод; внутренние детали не раскрываются.
   */
  private sendError(res: ServerResponse, error: unknown): void {
    if (res.headersSent) {
      return;
    }

    // Fail из fallback-ветки (endpoint без pipeline) — осознанная ошибка автора:
    // статус и детали сохраняем (как это делает pipeline через errorToResponse).
    if (error instanceof Fail) {
      sendResponse(res, {
        isSuccess: false,
        status: error.status,
        value:
          error.details !== undefined
            ? { error: error.message, details: error.details }
            : { error: error.message },
      });
      return;
    }

    let status = 500;
    const body: { error: string; details?: unknown; stack?: string } = {
      error: 'Internal server error',
    };

    if (
      error instanceof JsonParseError ||
      error instanceof PayloadConflictError
    ) {
      status = 400;
      body.error = error.message;
    } else if (error instanceof SchemaValidationError) {
      status = 400;
      body.error = 'Validation failed';
      body.details = error.zodError.issues;
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
   * Очищает непрочитанные file streams для предотвращения утечек памяти.
   */
  private cleanupFileStreams(
    inputType: string | undefined,
    payload: unknown,
  ): void {
    if (inputType !== 'withFiles' && inputType !== 'files') {
      return;
    }

    try {
      let files: { stream: NodeJS.ReadableStream }[] = [];

      if (inputType === 'withFiles') {
        const withFilesPayload = payload as {
          files?: { stream: NodeJS.ReadableStream }[];
        };
        files = withFilesPayload.files || [];
      } else if (inputType === 'files') {
        files = (payload as { stream: NodeJS.ReadableStream }[]) || [];
      }

      for (const file of files) {
        if (file.stream && 'readableEnded' in file.stream) {
          const readableStream = file.stream as NodeJS.ReadableStream & {
            readableEnded?: boolean;
            resume?: () => void;
          };

          if (!readableStream.readableEnded && readableStream.resume) {
            readableStream.resume();
          }
        }
      }
    } catch {
      // Игнорируем ошибки cleanup
    }
  }
}
