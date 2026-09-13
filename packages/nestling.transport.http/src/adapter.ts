/**
 * Адаптер-транспорт: приложение как обработчик запроса.
 *
 * Вторая форма работы пакета рядом с `http()`. Сокета у неё нет вовсе:
 * обработчик уходит наружу — в роут Next.js, в сервер Hono, в
 * Express-приложение. Разбор входа, маршрутизация и кадрирование ответа
 * общие с `http()`, потому что обе формы работают одним `HttpTransport`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { FetchSink, FetchSource } from './fetch.js';
import type { HttpRequestListener } from './interfaces.js';
import { HttpTransport$ } from './token.js';
import type { HttpTransportOptions } from './transport.js';
import { HTTP_CAPABILITIES, HttpTransport } from './transport.js';

import type {
  BuiltApp,
  Dispatch,
  ITransport,
  TransportDeclaration,
} from '@nestlingjs/app';
import { DEFAULT_INSTANCE, makeTransportDeclaration } from '@nestlingjs/app';
import { factoryProvider } from '@nestlingjs/container';

/**
 * Обработчик формы `node:http`.
 *
 * `false` означает «маршрут не этого приложения»: хозяин процесса
 * продолжает свою маршрутизацию, ответ не отправлен.
 */
export type HttpNodeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

/** Обработчик формы `fetch` */
export type HttpFetchHandler = (request: Request) => Promise<Response>;

/** Тело ответа на непойманный маршрут: то же, что отдаёт `HttpServer` */
const NOT_FOUND_BODY = 'Not Found';

/** Заглушка для проигравшей ветки гонки */
const noop = (): undefined => undefined;

/** Ответ на непойманный маршрут формы `fetch` */
const notFound = (): Response =>
  new Response(Buffer.from(NOT_FOUND_BODY), { status: 404 });

/**
 * HTTP-транспорт без сервера.
 *
 * Композиция с `HttpTransport`, а не наследование: адаптер не
 * переопределяет ни одного его метода, ему нужен только обработчик.
 * Транспорт присоединяет обработчик к приёмнику в `serve()` — адаптер и
 * есть такой приёмник, только вместо сокета он отдаёт обработчик наружу.
 * Поэтому расхождения между `http()` и адаптером не может быть по
 * устройству: разбор и кадрирование лежат в одном месте.
 */
export class HttpAdapter implements ITransport {
  readonly #transport: HttpTransport;

  /** Обработчик, полученный от транспорта в `serve()`; до неё его нет */
  #listener?: HttpRequestListener;

  constructor(options: HttpTransportOptions = {}) {
    this.#transport = new HttpTransport(
      { attach: (listener) => void (this.#listener = listener) },
      options,
    );
  }

  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    await this.#transport.serve(dispatch, signal);
  }

  async close(): Promise<void> {
    await this.#transport.close();
  }

  /** Обработчик формы `node:http`; до `serve()` его нет */
  get node(): HttpNodeHandler {
    return this.#handler();
  }

  /**
   * Обработчик формы `fetch`; до `serve()` его нет.
   *
   * Ответ уходит первым из двух: статус известен или кадрирование
   * закончилось. Ждать конца кадрирования нельзя — у потокового ответа
   * оно закончится только после последнего кадра, а хозяину процесса
   * `Response` нужен раньше.
   */
  get fetch(): HttpFetchHandler {
    const handle = this.#handler();

    return async (request: Request): Promise<Response> => {
      const source = new FetchSource(request);
      const sink = new FetchSink();

      // Разрыв соединения у хозяина — то же событие, что разрыв сокета
      request.signal.addEventListener('abort', () => sink.disconnect(), {
        once: true,
      });

      // Отказ `handle()` гасится здесь, а не уходит наружу: гонку
      // выигрывает ответ, и проигравшая ветка стала бы необработанным
      // отказом процесса
      await Promise.race([sink.response, handle(source, sink).catch(noop)]);

      return sink.sent ?? notFound();
    };
  }

  /** Обработчик или отказ с названной причиной */
  #handler(): HttpRequestListener {
    if (!this.#listener) {
      throw new Error(
        'Adapter has no request handler yet: a transport receives one in ' +
          'serve(), a step of START. Call run() on the application before ' +
          'asking the adapter for a handler.',
      );
    }

    return this.#listener;
  }
}

/**
 * Объявляет экземпляр HTTP-транспорта без сервера.
 *
 * Сборка с ним не открывает сокет и не заводит узел сервера: обработчик
 * запроса забирают у запущенного приложения через `toNodeHandler` или
 * `toFetchHandler`. Декларации `httpEndpoint` переезжают на адаптер без
 * правок — DI-токен и способности те же, что у `http()`. Из этого же
 * следует, что `http()` и `adapter()` под одним именем в одной сборке
 * дают занятый DI-токен, и контейнер отвергает сборку сам.
 *
 * Опций адреса у адаптера нет: адресом владеет хозяин процесса.
 *
 * @param options - Имя экземпляра и опции разбора запроса
 * @returns Объявление транспорта для `transports:` корня
 *
 * @example Приложение внутри чужого процесса
 * ```typescript
 * const app = makeApp({ features: [Users], transports: [adapter()] }).build();
 * await app.run({ signals: false });
 *
 * export const handler = toFetchHandler(app);
 * ```
 */
export const adapter = <const Name extends string = typeof DEFAULT_INSTANCE>(
  options: HttpTransportOptions & { readonly name?: Name } = {},
): TransportDeclaration<Name> => {
  const { name = DEFAULT_INSTANCE as Name, ...transportOptions } = options;
  const token = HttpTransport$(name);

  return makeTransportDeclaration({
    name,
    token,
    capabilities: HTTP_CAPABILITIES,
    provider: factoryProvider(
      token,
      () => new HttpAdapter(transportOptions),
      [],
    ),
  });
};

/** Имя экземпляра, у которого спрашивают обработчик */
export interface HandlerOptions {
  /** Имя экземпляра адаптера; по умолчанию `'default'` */
  readonly name?: string;
}

/**
 * Отдаёт обработчик формы `node:http` у запущенного приложения.
 *
 * Приложение поднимает и останавливает вызывающий код: скрытого подъёма
 * первым запросом нет, иначе хозяину процесса не осталось бы места, где
 * позвать `close()`.
 *
 * @param app - Собранное приложение после `run()`
 * @param options - Имя экземпляра адаптера
 * @returns `(req, res) => Promise<boolean>`; `false` — маршрут не этого
 * приложения
 *
 * @example Роут Express
 * ```typescript
 * const handler = toNodeHandler(app);
 *
 * server.use((req, res, next) => {
 *   void handler(req, res).then((taken) => (taken ? undefined : next()));
 * });
 * ```
 */
export function toNodeHandler(
  app: BuiltApp,
  options: HandlerOptions = {},
): HttpNodeHandler {
  return adapterOf(app, options.name ?? DEFAULT_INSTANCE, 'toNodeHandler').node;
}

/**
 * Отдаёт обработчик формы `fetch` у запущенного приложения.
 *
 * Непойманный маршрут даёт ответ `404`, а не пустое значение: роут
 * Next.js обязан вернуть `Response`, и хозяину пришлось бы дописывать
 * запасной ответ в каждом файле. Провалиться дальше по своей
 * маршрутизации даёт node-форма с её `false`.
 *
 * @param app - Собранное приложение после `run()`
 * @param options - Имя экземпляра адаптера
 * @returns `(request: Request) => Promise<Response>`
 *
 * @example Роут Next.js
 * ```typescript
 * export const POST = toFetchHandler(app);
 * ```
 */
export function toFetchHandler(
  app: BuiltApp,
  options: HandlerOptions = {},
): HttpFetchHandler {
  return adapterOf(app, options.name ?? DEFAULT_INSTANCE, 'toFetchHandler')
    .fetch;
}

/**
 * Достаёт адаптер из графа запущенного приложения.
 *
 * Три отказа, и каждый называет недостающий шаг: приложение не запущено,
 * имени нет в сборке, транспорт с таким именем владеет сокетом.
 */
function adapterOf(app: BuiltApp, name: string, caller: string): HttpAdapter {
  const { transports } = app;

  if (transports.size === 0) {
    throw new Error(
      `Application is not running, so it has no request handler: call ` +
        `run() before ${caller}().`,
    );
  }

  const instance = transports.get(name);

  if (!instance) {
    throw new Error(
      `No transport named '${name}' in this application; it declares: ` +
        `${[...transports.keys()].join(', ')}.`,
    );
  }

  if (!(instance instanceof HttpAdapter)) {
    throw new TypeError(
      `Transport '${name}' owns a socket, so it has no handler to hand ` +
        `out: declare adapter({ name: '${name}' }) instead of ` +
        `http({ name: '${name}' }).`,
    );
  }

  return instance;
}
