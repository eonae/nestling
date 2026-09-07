/**
 * `HttpServer` — узел графа, который владеет сокетом, и его объявление
 * `httpServer({ name? })`.
 *
 * Сокет отделён от транспорта потому, что разделяемая вещь — именно он:
 * два слушателя на один порт не биндятся, а транспортов на одном порту
 * бывает несколько. Транспорт присоединяет обработчик в `serve`, сервер
 * открывает сокет последним шагом START.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { HttpServerConfig } from './config.js';

import type {
  ConfigProjection,
  IListener,
  ServerDeclaration,
} from '@nestling/app';
import { DEFAULT_INSTANCE, makeServerDeclaration } from '@nestling/app';
import type { InjectionToken } from '@nestling/container';
import { makeTokenFamily, resourceProvider } from '@nestling/container';

/** Сколько `drain()` ждёт активные соединения по умолчанию (10 с) */
const DEFAULT_CLOSE_TIMEOUT = 10_000;

/** Период зачистки освободившихся keep-alive соединений при дренаже (мс) */
const IDLE_SWEEP_INTERVAL = 100;

/** Значения конфиг-секции сервера, которые получает провайдер */
type HttpServerConfigValues = ConfigProjection<
  ReturnType<typeof HttpServerConfig>
>;

/**
 * Семейство DI-токенов HTTP-сервера: один член на экземпляр.
 *
 * Параметр — имя экземпляра, то же, что у транспорта: `http()` без
 * `server` заводит сервер с собственным именем, поэтому `HttpServer$` и
 * `HttpTransport$` члена одного имени описывают одну пару.
 */
export const HttpServer$ = makeTokenFamily<HttpServer, [instance: string]>(
  'server:http',
);

/**
 * Обработчик запроса, присоединённый к серверу.
 *
 * Возвращает `true`, если ответ отправлен, и `false`, если запрос не его:
 * без этого признака два транспорта на одном сокете невозможны — первый
 * отвечал бы `404` на чужие маршруты.
 */
export type HttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

/** Опции HTTP-сервера: всё, что относится к сокету, а не к разбору запроса */
export interface HttpServerOptions {
  /** `server.requestTimeout` (мс). Не задан — дефолт Node. */
  requestTimeout?: number;

  /** `server.headersTimeout` (мс). Не задан — дефолт Node. */
  headersTimeout?: number;

  /** `server.keepAliveTimeout` (мс). Не задан — дефолт Node. */
  keepAliveTimeout?: number;

  /**
   * Сколько `drain()` ждёт завершения активных запросов (мс). По истечении
   * оставшиеся соединения закрываются принудительно. По умолчанию 10 с.
   */
  closeTimeout?: number;
}

/** Адрес и опции сервера: то, что провайдер собирает из секции и фабрики */
export interface HttpServerSpec extends HttpServerOptions {
  /** Порт; `0` означает «выберет ядро ОС» */
  port: number;

  /** Интерфейс, на котором открывается сокет */
  host: string;
}

/**
 * HTTP-сервер: `http.Server` плюс цепочка обработчиков.
 *
 * Роли делятся по фазам. Как ресурс сервер создаётся на INIT
 * (конструктор заводит `http.Server`, сокет не открывая) и освобождается
 * в `destroy()` контейнера (`release`). Как слушатель он открывает сокет
 * последним шагом START (`listen`) и дренажит соединения первым шагом
 * SHUTDOWN (`drain`).
 */
export class HttpServer implements IListener {
  private readonly server: Server;

  private readonly port: number;

  private readonly host: string;

  private readonly closeTimeout: number;

  /** Обработчики в порядке присоединения; цепочку строит `listen()` */
  private readonly handlers: HttpHandler[] = [];

  /**
   * Цепочка обработчиков, выбранная один раз на `listen()`.
   *
   * Ветка выбирается здесь, а не на каждый запрос: при единственном
   * обработчике цепочка вырождается в прямой вызов.
   */
  private chain?: HttpHandler;

  /** Фактический адрес; не задан до `listen()` и после дренажа */
  private listening?: { host: string; port: number };

  /** Сокет уже закрыт — дренажом или освобождением ресурса */
  private closed = false;

  constructor(spec: HttpServerSpec) {
    this.port = spec.port;
    this.host = spec.host;
    this.closeTimeout = spec.closeTimeout ?? DEFAULT_CLOSE_TIMEOUT;

    this.server = createServer((request, response) => {
      this.accept(request, response).catch(() => {
        if (!response.headersSent) {
          response.statusCode = 500;
          response.end('Internal Server Error');
        }
      });
    });

    // Таймауты node:http меняются только при явных опциях; иначе остаются
    // дефолты Node
    if (spec.requestTimeout !== undefined) {
      this.server.requestTimeout = spec.requestTimeout;
    }
    if (spec.headersTimeout !== undefined) {
      this.server.headersTimeout = spec.headersTimeout;
    }
    if (spec.keepAliveTimeout !== undefined) {
      this.server.keepAliveTimeout = spec.keepAliveTimeout;
    }
  }

  /**
   * Присоединяет обработчик к концу цепочки.
   *
   * Зовётся транспортом из `serve`, то есть до `listen()`. Порядок
   * обработчиков — порядок присоединения, а он задан порядком объявления
   * транспортов в `transports:`.
   *
   * @param handler - Обработчик; `false` означает «маршрут не мой»
   * @throws {Error} Присоединение после открытия сокета
   */
  attach(handler: HttpHandler): void {
    if (this.chain) {
      throw new Error(
        'HTTP server is already listening, so a handler cannot be attached: ' +
          'handlers are attached in serve() and the socket opens after all ' +
          'of them. A transport reaching this line runs outside the ' +
          'assembled application.',
      );
    }

    this.handlers.push(handler);
  }

  /**
   * Открывает сокет.
   *
   * Последний шаг START: к этому моменту каждый транспорт присоединил свой
   * обработчик, поэтому запрос не может прийти раньше, чем его есть кому
   * обслужить.
   */
  async listen(): Promise<void> {
    if (this.chain) {
      throw new Error('HTTP server is already listening');
    }

    this.chain = chainOf(this.handlers);

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        reject(error);
      };

      this.server.once('error', onError);

      this.server.listen(this.port, this.host, () => {
        this.server.off('error', onError);

        // Фактический адрес известен только теперь: при `HTTP_PORT=0` его
        // выбирает ядро ОС
        const address = this.server.address();
        this.listening =
          address && typeof address === 'object'
            ? { host: address.address, port: address.port }
            : { host: this.host, port: this.port };

        resolve();
      });
    });
  }

  /**
   * Возвращает фактический адрес сервера.
   *
   * `null` до `listen()` и после дренажа. Нужен при `HTTP_PORT=0`, когда
   * порт выбирает ядро ОС, например в интеграционных тестах.
   */
  address(): { host: string; port: number } | null {
    return this.listening ?? null;
  }

  /**
   * Перестаёт принимать соединения и дочитывает открытые.
   *
   * Порядок: перестать принимать новые соединения (`server.close`), сразу
   * закрыть простаивающие keep-alive (`closeIdleConnections`), дождаться
   * завершения активных запросов до `closeTimeout` и закрыть оставшиеся
   * принудительно (`closeAllConnections`). Завершается за конечное время
   * даже при живых keep-alive соединениях.
   *
   * Отмену запросов в обработке дренаж не делает: это `close()`
   * транспорта, и он идёт следом.
   */
  async drain(): Promise<void> {
    if (this.closed || !this.listening) {
      return;
    }

    this.closed = true;
    this.listening = undefined;

    await new Promise<void>((resolve, reject) => {
      // Активные запросы ждём до closeTimeout, затем закрываем
      // принудительно. Таймер не должен держать процесс живым
      const timer = setTimeout(() => {
        this.server.closeAllConnections();
      }, this.closeTimeout);
      timer.unref?.();

      // Keep-alive соединение, освободившееся после начала close(), Node
      // сам не закрывает: без периодической зачистки ожидание длилось бы
      // до keep-alive таймаута клиента
      const idleSweep = setInterval(() => {
        this.server.closeIdleConnections();
      }, IDLE_SWEEP_INTERVAL);
      idleSweep.unref?.();

      // server.close ждёт завершения всех соединений; колбэк — когда
      // закрылись
      this.server.close((error) => {
        clearTimeout(timer);
        clearInterval(idleSweep);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });

      // Простаивающие keep-alive закрываем немедленно, иначе server.close
      // ждал бы их таймаута со стороны клиента
      this.server.closeIdleConnections();
    });
  }

  /**
   * Отпускает дескриптор сокета.
   *
   * Освобождение ресурса, а не шаг реверса START: зовётся последним, в
   * `destroy()` контейнера. После `drain()` идемпотентен — сокет уже
   * закрыт. Без дренажа (провал захвата на INIT, когда `listen` ещё не
   * вызывался) закрывает всё, что открыто, не дожидаясь соединений.
   */
  async release(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.listening = undefined;

    if (!this.server.listening) {
      return;
    }

    this.server.closeAllConnections();

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /** Проводит запрос по цепочке и отвечает `404`, если его никто не взял */
  private async accept(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const taken = await this.chain?.(request, response);

    if (!taken && !response.headersSent) {
      response.statusCode = 404;
      response.end('Not Found');
    }
  }
}

/**
 * Строит цепочку из присоединённых обработчиков.
 *
 * Один обработчик — прямой вызов без обёртки: приложение с единственным
 * транспортом не платит за возможность иметь второй. Ни одного — сервер
 * отвечает `404` на всё.
 */
function chainOf(handlers: readonly HttpHandler[]): HttpHandler {
  if (handlers.length === 0) {
    return async () => false;
  }

  if (handlers.length === 1) {
    return handlers[0];
  }

  const chain = [...handlers];

  return async (request, response) => {
    for (const handler of chain) {
      if (await handler(request, response)) {
        return true;
      }
    }

    return false;
  };
}

/**
 * Объявляет экземпляр HTTP-сервера.
 *
 * Возвращает объявление ресурса, а не инстанс: сервер — обычный узел
 * графа, его создаёт контейнер на INIT и освобождает на SHUTDOWN. Порт и
 * хост приходят из конфиг-секции по имени экземпляра: `HTTP_PORT` и
 * `HTTP_HOST` у сервера по умолчанию, `HTTP_ADMIN_PORT` и
 * `HTTP_ADMIN_HOST` у `name: 'admin'`. Опций порта и хоста у фабрики нет:
 * адрес меняется без пересборки образа, поэтому он в конфиге.
 *
 * Объявлять сервер явно нужно там, где на одном сокете работает больше
 * одного транспорта. `transports: [http()]` заводит сервер сам.
 *
 * @param options - Имя экземпляра и таймауты `node:http`
 * @returns Объявление сервера для `transports:` корня
 *
 * @example Два транспорта на одном сокете
 * ```typescript
 * const api = httpServer({ name: 'api' });
 *
 * await makeApp({
 *   features: [Users],
 *   transports: [api, http({ server: api }), graphql({ server: api })],
 * }).assemble().run();
 * ```
 */
export const httpServer = <const Name extends string = typeof DEFAULT_INSTANCE>(
  options: HttpServerOptions & { readonly name?: Name } = {},
): ServerDeclaration<Name> => {
  const { name = DEFAULT_INSTANCE as Name, ...serverOptions } = options;
  const token = HttpServer$(name);
  const section = HttpServerConfig(name);

  return makeServerDeclaration({
    name,
    token,
    provider: resourceProvider(token, {
      deps: [
        section as unknown as InjectionToken<HttpServerConfigValues>,
      ] as const,
      acquire: (config: HttpServerConfigValues) =>
        new HttpServer({
          port: config.port,
          host: config.host,
          ...serverOptions,
        }),
      release: (server: HttpServer) => server.release(),
    }),
  });
};
