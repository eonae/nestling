import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { URL } from 'node:url';

import type {
  HandlerConfig,
  RequestContext,
  RouteConfig,
  Transport,
} from '../core/interfaces.js';
import { Pipeline } from '../core/pipeline.js';

import { sendResponse } from './adapter.js';
import { parseJson, parseMultipart, parseRaw } from './parser.js';
import { HttpRouter } from './router.js';

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
  registerHandler(config: HandlerConfig): void {
    const { handler, method, path, input } = config;

    if (!method || !path) {
      throw new Error('HTTP handler config must include method and path');
    }

    const routeConfig: RouteConfig = {
      method: String(method),
      path: String(path),
      handler,
    };

    if (input && typeof input === 'object') {
      routeConfig.input = input as RouteConfig['input'];
    }

    this.router.route(routeConfig);
  }

  /**
   * Регистрирует маршрут (для обратной совместимости)
   */
  route(config: RouteConfig): void {
    this.router.route(config);
  }

  /**
   * Добавляет middleware в пайплайн
   */
  use(middleware: Parameters<Pipeline['use']>[0]): void {
    this.pipeline.use(middleware);
  }

  /**
   * Обрабатывает HTTP запрос
   */
  async handle(nativeReq: unknown, nativeRes: unknown): Promise<void> {
    const req = nativeReq as IncomingMessage;
    const res = nativeRes as ServerResponse;

    try {
      // Находим маршрут
      const route = this.router.find(req);
      if (!route) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      // Парсим URL для query параметров
      const url = new URL(
        req.url || '/',
        `http://${req.headers.host || 'localhost'}`,
      );
      const query: Record<string, string> = {};
      for (const [key, value] of url.searchParams.entries()) {
        query[key] = value;
      }

      // Создаем RequestContext
      const requestContext: RequestContext = {
        transport: 'http',
        method: req.method || 'GET',
        path: url.pathname,
        headers: req.headers as Record<string, string>,
        query: Object.keys(query).length > 0 ? query : undefined,
        meta: {
          params: route.params,
        },
      };

      // Парсим body согласно конфигурации маршрута
      if (route.config.input?.body) {
        switch (route.config.input.body) {
          case 'json': {
            requestContext.body = await parseJson(req);

            break;
          }
          case 'raw': {
            requestContext.body = await parseRaw(req);

            break;
          }
          case 'stream': {
            requestContext.streams = {
              body: req,
            };

            break;
          }
          // No default
        }
      }

      // Парсим multipart если нужно
      if (route.config.input?.multipart) {
        const files = await parseMultipart(req);
        if (files.length > 0) {
          if (!requestContext.streams) {
            requestContext.streams = {};
          }
          requestContext.streams.files = files;
        }
      }

      // Устанавливаем handler в пайплайн
      this.pipeline.setHandler(route.handler);

      // Выполняем пайплайн
      const responseContext = await this.pipeline.execute(requestContext);

      // Отправляем ответ
      sendResponse(res, responseContext);
    } catch (error) {
      // Обработка ошибок
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(
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
