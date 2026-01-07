import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Readable } from 'node:stream';

import { sendResponse } from './adapter.js';
import { mergePayload } from './merge.js';
import { parseJson, parseMultipart, parseRaw } from './parser.js';
import { HttpRouter } from './router.js';

import type { Constructor, MaybeSchema } from '@common/misc';
import type {
  FilePart,
  HandlerConfig,
  IMiddleware,
  MiddlewareFn,
  RequestContext,
  RouteConfig,
  Transport,
} from '@nestling/transport';
import { parseMetadata, parsePayload, Pipeline } from '@nestling/transport';

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
export class HttpTransport implements Transport {
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
  registerHandler<
    P extends MaybeSchema = MaybeSchema,
    M extends MaybeSchema = MaybeSchema,
    R extends MaybeSchema = MaybeSchema,
  >(config: HandlerConfig<P, M, R>): void {
    const {
      handler,
      method,
      path,
      payloadSchema,
      metadataSchema,
      responseSchema,
    } = config;

    if (!method || !path) {
      throw new Error('HTTP handler config must include method and path');
    }

    const routeConfig: RouteConfig<P, M, R> = {
      method: String(method),
      path: String(path),
      handler,
    };

    if (payloadSchema) {
      routeConfig.payloadSchema = payloadSchema;
    }

    if (metadataSchema) {
      routeConfig.metadataSchema = metadataSchema;
    }

    if (responseSchema) {
      routeConfig.responseSchema = responseSchema;
    }

    this.router.route(routeConfig);
  }

  /**
   * Регистрирует маршрут
   */
  route<
    P extends MaybeSchema = MaybeSchema,
    M extends MaybeSchema = MaybeSchema,
    R extends MaybeSchema = MaybeSchema,
  >(config: RouteConfig<P, M, R>): void {
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

      // Переменные для данных запроса
      let body: unknown;
      let streamBody: Readable | undefined;
      let files: FilePart[] | undefined;

      // Парсим body согласно конфигурации маршрута
      if (route.config.input?.body) {
        switch (route.config.input.body) {
          case 'json': {
            body = await parseJson(nativeReq);
            break;
          }
          case 'raw': {
            body = await parseRaw(nativeReq);
            break;
          }
          case 'stream': {
            streamBody = nativeReq;
            break;
          }
          // No default
        }
      }

      // Парсим multipart если нужно
      if (route.config.input?.multipart) {
        const parsedFiles = await parseMultipart(nativeReq);
        if (parsedFiles.length > 0) {
          files = parsedFiles;
        }
      }

      // Объединяем body, query и params в payload
      const payload = mergePayload(
        body,
        Object.keys(query).length > 0 ? query : undefined,
        route.params,
      );

      // Создаем RequestContext
      const requestContext: RequestContext = {
        transport: 'http',
        method: nativeReq.method || 'GET',
        path: url.pathname,
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
      // Создаем inputSources с исходными данными для парсинга
      const inputSources = {
        payload: payload as Record<string, unknown>,
        metadata: requestContext.metadata as Record<string, unknown>,
      };

      requestContext.payload = route.config.payloadSchema
        ? parsePayload(route.config.payloadSchema, inputSources)
        : undefined;
      requestContext.metadata = route.config.metadataSchema
        ? parseMetadata(route.config.metadataSchema, inputSources)
        : undefined;

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
