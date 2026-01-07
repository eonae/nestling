import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Readable } from 'node:stream';

import { sendResponse } from './adapter.js';
import { mergePayload } from './merge.js';
import {
  parseFilesOnly,
  parseJson,
  parseRaw,
  parseStream,
  parseWithFiles,
} from './parser.js';
import { HttpRouter } from './router.js';

import type { Constructor, Optional, Schema } from '@common/misc';
import type {
  FilePart,
  HandlerConfig,
  IMiddleware,
  Input,
  MiddlewareFn,
  Output,
  RequestContext,
} from '@nestling/pipeline';
import {
  analyzeInput,
  parseMetadata,
  parsePayload,
  Pipeline,
} from '@nestling/pipeline';
import type { ITransport, RouteConfig } from '@nestling/transport';

/**
 * Опции для HTTP транспорта
 */
export interface HttpTransportOptions {
  port?: number;
  host?: string;
}

/**
 * HTTP транспорт
 */
export class HttpTransport implements ITransport {
  private readonly router: HttpRouter;
  private readonly pipeline: Pipeline;
  private server?: Server;
  private readonly options: HttpTransportOptions;

  constructor(options: HttpTransportOptions = {}) {
    this.router = new HttpRouter();
    this.pipeline = new Pipeline();
    this.options = options;
  }

  /**
   * Регистрирует handler через конфигурацию
   */
  endpoint<
    I extends Input = Schema,
    O extends Output = Schema,
    M extends Optional<Schema> = Optional<Schema>,
  >(config: HandlerConfig<I, O, M>): void {
    const { handle, pattern, input, metadata, output } = config;

    const routeConfig: RouteConfig<I, O, M> = {
      pattern,
      handle,
      input,
      metadata,
      output,
    };

    this.router.route(routeConfig);
  }

  /**
   * Регистрирует маршрут
   */
  route<
    I extends Input = Schema,
    O extends Output = Schema,
    M extends Optional<Schema> = Optional<Schema>,
  >(config: RouteConfig<I, O, M>): void {
    this.router.route(config);
  }

  /**
   * Добавляет middleware в пайплайн
   */
  use(middleware: MiddlewareFn | Constructor<IMiddleware>): void {
    this.pipeline.use(middleware);
  }

  /**
   * Обрабатывает HTTP запрос (внутренний метод)
   */
  private async handle(
    nativeReq: IncomingMessage,
    nativeRes: ServerResponse,
  ): Promise<void> {
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
      const inputConfig = analyzeInput(route.config.input);

      // Переменные для данных запроса
      let payload: unknown;
      let streamBody: Readable | undefined;
      let files: FilePart[] | undefined;

      // Парсим входные данные согласно типу модификатора
      switch (inputConfig.type) {
        case 'stream': {
          // Streaming данные
          payload = parseStream(
            nativeReq,
            inputConfig.schema as Optional<Schema>,
          );

          break;
        }
        case 'withFiles': {
          // Структурированные данные + файлы
          const result = await parseWithFiles(
            nativeReq,
            inputConfig.schema as Optional<Schema>,
          );
          payload = result.data;
          files = result.files;

          break;
        }
        case 'files': {
          // Только файлы
          files = await parseFilesOnly(nativeReq);
          payload = files;

          break;
        }
        case 'primitive': {
          // Примитивные типы
          if (inputConfig.primitive === 'binary') {
            payload = await parseRaw(nativeReq);
          } else if (inputConfig.primitive === 'text') {
            const chunks: Buffer[] = [];
            for await (const chunk of nativeReq) {
              chunks.push(chunk);
            }
            payload = Buffer.concat(chunks).toString();
          }

          break;
        }
        default: {
          // Обычная схема или undefined - парсим как JSON и объединяем с query/params
          let body: unknown;

          if (inputConfig.schema) {
            // Схема без модификатора - парсим как JSON
            body = await parseJson(nativeReq);
          }

          // Объединяем body, query и params в payload
          payload = mergePayload(
            body,
            Object.keys(query).length > 0 ? query : undefined,
            route.params,
          );
        }
      }

      // Создаем RequestContext
      const requestContext: RequestContext = {
        transport: 'http',
        pattern: `${nativeReq.method || 'GET'} ${url.pathname}`,
        payload,
        metadata: {
          headers: nativeReq.headers as Record<string, string>,
        },
        ...(streamBody || files
          ? {
              streams: {
                ...(streamBody && { body: streamBody }),
                ...(files && { files }),
              },
            }
          : {}),
      };

      // Валидируем и парсим payload и metadata только если схемы указаны
      // Для stream, withFiles, files - payload уже готов, не валидируем повторно
      if (
        inputConfig.type !== 'stream' &&
        inputConfig.type !== 'withFiles' &&
        inputConfig.type !== 'files' &&
        inputConfig.type === 'schema' &&
        inputConfig.schema
      ) {
        const inputSources = {
          payload: payload as Record<string, unknown>,
          metadata: requestContext.metadata as Record<string, unknown>,
        };

        requestContext.payload = parsePayload(
          inputConfig.schema as Schema,
          inputSources,
        );
      }

      if (route.config.metadata) {
        const inputSources = {
          payload: payload as Record<string, unknown>,
          metadata: requestContext.metadata as Record<string, unknown>,
        };

        requestContext.metadata = parseMetadata(
          route.config.metadata as Schema,
          inputSources,
        );
      }

      // Выполняем пайплайн с requestContext
      const responseContext = await this.pipeline.executeWithHandler(
        route.handler,
        requestContext,
      );

      // Отправляем ответ
      sendResponse(nativeRes, responseContext);
    } catch (error) {
      // Обработка ошибок
      nativeRes.statusCode = 500;
      nativeRes.setHeader('content-type', 'application/json');
      nativeRes.end(
        JSON.stringify({
          error:
            error instanceof Error ? error.message : 'Internal Server Error',
        }),
      );
    }
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

      this.server.listen(listenPort, listenHost, () => {
        resolve();
      });

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Останавливает HTTP сервер
   */
  async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;

    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}
