/**
 * Пара `HttpSource`/`HttpSink` поверх `Request` и `Response`.
 *
 * Вторая реализация байтовой границы рядом с классами `node:http`. Разбор
 * входа, маршрутизация и кадрирование ответа у обеих одни и те же:
 * расходиться нечему, потому что общий код ровно один.
 */

import { Readable } from 'node:stream';

import type { HttpSink, HttpSinkHeaders, HttpSource } from './interfaces.js';

/**
 * Промис вместе с его `resolve`.
 *
 * `Promise.withResolvers` появился в ES2024, а пакеты компилируются с
 * библиотекой ES2022.
 */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle!: (value: T) => void;

  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

/** Приводит кадр к байтам: строку кодирует, байты отдаёт как есть */
function toBytes(chunk: string | Buffer | Uint8Array): Uint8Array {
  return typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
}

/**
 * Запрос формы `fetch`.
 *
 * `url` — путь с query-строкой, а не абсолютный адрес: роутер сравнивает
 * путь, и `http://host` в нём не участвует. Тело заворачивается в поток
 * `node:stream`, потому что разбор `multipart` отдаёт его busboy; запрос
 * без тела даёт пустой поток, и форма `value` не читает его вовсе.
 */
export class FetchSource implements HttpSource {
  readonly method: string;

  readonly url: string;

  readonly headers: Record<string, string | string[] | undefined>;

  readonly #body: Readable;

  constructor(request: Request) {
    const { pathname, search } = new URL(request.url);

    this.method = request.method;
    this.url = `${pathname}${search}`;
    this.headers = Object.fromEntries(request.headers);
    this.#body = request.body
      ? Readable.fromWeb(request.body as never)
      : Readable.from([]);
  }

  [Symbol.asyncIterator](): AsyncIterator<Buffer> {
    return this.#body[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  pipe<T extends NodeJS.WritableStream>(destination: T): T {
    return this.#body.pipe(destination);
  }

  unpipe(destination?: NodeJS.WritableStream): void {
    this.#body.unpipe(destination);
  }

  resume(): void {
    this.#body.resume();
  }
}

/**
 * Ответ формы `fetch`.
 *
 * `Response` собирается, как только известен статус, а не по завершении
 * кадрирования: у потокового ответа кадрирование закончится только после
 * последнего кадра, а хозяину процесса ответ нужен раньше. Собирают его
 * четыре точки:
 *
 * - `end()` без единого кадра — ответ значения с готовым телом;
 * - `flushHeaders()` (SSE), первый `write` (NDJSON) — потоковый ответ,
 *   тело которого дописывается дальше;
 * - `destroy()` — оборванный ответ: статус уже известен, а тело ошибочно.
 */
export class FetchSink implements HttpSink {
  statusCode = 200;

  readonly #headers = new Headers();

  readonly #closeListeners: (() => void)[] = [];

  readonly #ready = deferred<Response>();

  /** Контроллер тела потокового ответа; у ответа значения его нет */
  #controller?: ReadableStreamDefaultController<Uint8Array>;

  #response?: Response;

  #ended = false;

  #destroyed = false;

  #closed = false;

  /** Ответ, как только известен статус; не отвергается никогда */
  get response(): Promise<Response> {
    return this.#ready.promise;
  }

  /** Тот же ответ без ожидания: `undefined`, пока статус неизвестен */
  get sent(): Response | undefined {
    return this.#response;
  }

  get headersSent(): boolean {
    return this.#response !== undefined;
  }

  get writableEnded(): boolean {
    return this.#ended;
  }

  get writableFinished(): boolean {
    return this.#ended && !this.#destroyed;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    if (typeof value === 'string' || typeof value === 'number') {
      this.#headers.set(name, String(value));
      return;
    }

    // Список — повтор заголовка: так уходят несколько `Set-Cookie`
    this.#headers.delete(name);
    for (const item of value) {
      this.#headers.append(name, item);
    }
  }

  writeHead(status: number, headers: HttpSinkHeaders): void {
    this.statusCode = status;

    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) {
        this.setHeader(name, value);
      }
    }
  }

  write(
    chunk: string | Buffer | Uint8Array,
    callback?: (error?: Error | null) => void,
  ): boolean {
    if (this.#ended || this.#destroyed) {
      callback?.(new Error('Response is already finished'));
      return false;
    }

    const controller = this.#open();
    controller.enqueue(toBytes(chunk));
    callback?.();

    // Признак свободного места: читатель не выбрал очередь — значит, кадр
    // ещё не ушёл, и кадрирование ждёт колбэк вместо следующего кадра
    return (controller.desiredSize ?? 0) > 0;
  }

  end(chunk?: string | Buffer | Uint8Array): void {
    if (this.#ended || this.#destroyed) {
      return;
    }

    this.#ended = true;

    if (this.#controller) {
      if (chunk !== undefined) {
        this.#controller.enqueue(toBytes(chunk));
      }
      this.#controller.close();
    } else {
      this.#take(
        new Response(chunk === undefined ? null : toBytes(chunk), {
          status: this.statusCode,
          headers: this.#headers,
        }),
      );
    }

    this.#emitClose();
  }

  flushHeaders(): void {
    if (!this.#ended && !this.#destroyed) {
      this.#open();
    }
  }

  destroy(): void {
    if (this.#ended || this.#destroyed) {
      return;
    }

    this.#destroyed = true;

    // Статус ушёл раньше тела, сменить его нечем: читателю остаётся
    // ошибка потока — тот же признак неполных данных, что оборванный
    // chunked-ответ на сокете
    this.#open().error(new Error('Response stream was destroyed mid-body'));
    this.#emitClose();
  }

  on(event: 'close', listener: () => void): void {
    if (event !== 'close') {
      return;
    }

    // Соединение могло оборваться до того, как транспорт дошёл до
    // подписки: слушатель всё равно обязан узнать об этом
    if (this.#closed) {
      listener();
      return;
    }

    this.#closeListeners.push(listener);
  }

  /**
   * Хозяин разорвал соединение.
   *
   * Событие то же, что у сокета, поэтому дальше работает тот же код:
   * транспорт взводит сигнал контекста `ClientDisconnectedError`, а
   * кадрирование останавливается на ближайшей проверке `destroyed`.
   */
  disconnect(): void {
    if (this.#ended || this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.#controller?.error(new Error('Client disconnected'));
    this.#emitClose();
  }

  /** Открывает тело потокового ответа; повторный вызов отдаёт тот же контроллер */
  #open(): ReadableStreamDefaultController<Uint8Array> {
    if (this.#controller) {
      return this.#controller;
    }

    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: (source) => {
        controller = source;
      },
    });

    this.#controller = controller;
    this.#take(
      new Response(stream, {
        status: this.statusCode,
        headers: this.#headers,
      }),
    );

    return controller;
  }

  /** Запоминает ответ; второй вызов ничего не меняет */
  #take(response: Response): void {
    if (this.#response) {
      return;
    }

    this.#response = response;
    this.#ready.settle(response);
  }

  #emitClose(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    for (const listener of this.#closeListeners) {
      listener();
    }
  }
}
