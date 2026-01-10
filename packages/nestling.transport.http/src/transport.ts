import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { sendResponse } from './adapter.js';
import type { HttpEndpointMetadata } from './helpers.js';
import { mergePayload } from './merge.js';
import {
  parseFilesOnly,
  parseJson,
  parseRaw,
  parseStream,
  parseWithFiles,
} from './parser.js';
import { HttpRouter } from './router.js';

import type { Schema } from '@common/misc';
import type {
  AnyInput,
  AnyMeta,
  AnyOutput,
  EndpointDefinition,
  EndpointMeta,
  IEndpoint,
  InferInput,
  Pipeline,
  Raw,
  UnvalidatedContext,
} from '@nestling/pipeline';
import { analyzeInput, parsePayload } from '@nestling/pipeline';

/**
 * Опции для HTTP транспорта
 */
export interface HttpTransportOptions {
  port?: number;
  host?: string;
}

/**
 * HTTP транспорт
 *
 * Работает с новой архитектурой:
 * - Создаёт Raw и UnvalidatedContext
 * - Выполняет pipeline из endpoint metadata
 * - Handler получает только (input, meta)
 */
export class HttpTransport {
  private readonly router: HttpRouter;
  private server?: Server;

  constructor(private readonly options: HttpTransportOptions = {}) {
    this.router = new HttpRouter();
  }

  /**
   * Регистрирует endpoint
   */
  registerEndpoint<
    I extends AnyInput = AnyInput,
    O extends AnyOutput = AnyOutput,
    M extends AnyMeta = AnyMeta,
  >(
    instance: IEndpoint<I, O, M>,
    metadata: HttpEndpointMetadata<I, O, M>,
  ): void {
    this.router.route({
      transport: 'http',
      pattern: metadata.pattern,
      input: metadata.input,
      output: metadata.output,
      pipeline: metadata.pipeline,
      handle: (input: InferInput<I>, meta: M) => instance.handle(input, meta),
    });
  }

  /**
   * Регистрирует маршрут через definition
   */
  route<
    I extends AnyInput = AnyInput,
    O extends AnyOutput = AnyOutput,
    M extends AnyMeta = AnyMeta,
  >(definition: EndpointDefinition<I, O, M>): void {
    this.router.route(definition);
  }

  /**
   * Alias для route() - реализация ITransport интерфейса
   */
  endpoint<
    I extends AnyInput = AnyInput,
    O extends AnyOutput = AnyOutput,
    M extends AnyMeta = AnyMeta,
  >(definition: EndpointDefinition<I, O, M>): void {
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
      const inputConfig = analyzeInput(route.definition.input);
      inputConfigType = inputConfig.type;

      // Парсим входные данные согласно типу модификатора
      switch (inputConfig.type) {
        case 'stream': {
          payload = parseStream(nativeReq, inputConfig.schema as Schema);
          break;
        }
        case 'withFiles': {
          const result = await parseWithFiles(nativeReq);
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
          payload = await parseFilesOnly(nativeReq);
          break;
        }
        case 'primitive': {
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
          let body: unknown;
          if (inputConfig.schema) {
            body = await parseJson(nativeReq);
          }
          payload = mergePayload(
            body,
            Object.keys(query).length > 0 ? query : undefined,
            route.params,
          );
        }
      }

      // Получаем pipeline из endpoint metadata
      const definition = route.definition as any;
      const pipeline = definition.pipeline as Pipeline<any, any> | undefined;

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

        const ctx: UnvalidatedContext = {
          raw,
          meta: {},
          endpoint: endpointMeta,
        };

        const responseContext = await pipeline.executeWithHandler(
          route.handler,
          ctx,
        );

        this.cleanupFileStreams(inputConfigType, payload);
        sendResponse(nativeRes, responseContext);
      } else {
        // Fallback для endpoint'ов без pipeline (прямой вызов handler)
        // Валидируем payload если есть schema
        if (
          inputConfig.type !== 'stream' &&
          inputConfig.type !== 'withFiles' &&
          inputConfig.type !== 'files' &&
          inputConfig.type === 'schema' &&
          inputConfig.schema
        ) {
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
