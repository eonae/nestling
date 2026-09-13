/**
 * Байтовая граница транспорта: что он читает у запроса и во что пишет
 * ответ.
 *
 * Интерфейсы повторяют форму `IncomingMessage` и `ServerResponse` ровно в
 * той части, которой пользуется код. Повторяют, а не заменяют: классы
 * `node:http` удовлетворяют им как есть, поэтому на пути `http()` не
 * появляется ни одной обёртки на запрос. Вторая реализация пары — форма
 * `fetch` адаптера, третья — приёмник автора своего транспорта.
 *
 * Отсюда и странности, унаследованные у `node:http`: `writeHead` рядом с
 * `setHeader`, `destroy` рядом с `end`. Это цена нулевой обёртки на
 * горячем пути.
 */

/** Заголовки запроса: имена в нижнем регистре, повторы — списком */
export type HttpSourceHeaders = Record<string, string | string[] | undefined>;

/** Заголовки ответа: значение уходит как есть, список — повтором заголовка */
export type HttpSinkHeaders = Record<
  string,
  number | string | string[] | undefined
>;

/**
 * Запрос: то, что читают роутер, разбор входа и стартовый контекст.
 *
 * Байты приходят асинхронной итерацией. Разбор тела читает её вручную и
 * при превышении лимита перестаёт звать `next()`, а не выходит из цикла:
 * выход закрыл бы поток, и ответ 413 не успел бы уйти.
 */
export interface HttpSource extends AsyncIterable<Buffer> {
  /** Метод запроса; без него транспорт считает запрос `GET` */
  readonly method?: string;

  /** Путь с query-строкой, как прислан клиентом */
  readonly url?: string;

  readonly headers: HttpSourceHeaders;

  /** Сокет клиента; у формы `fetch` его нет, и `ctx.http.ip` пуст */
  readonly socket?: { readonly remoteAddress?: string };

  /** Отдаёт байты потребителю: этим разбор `multipart` кормит busboy */
  pipe<T extends NodeJS.WritableStream>(destination: T): T;

  /** Отсоединяет потребителя: разбор `multipart` делает это при отказе */
  unpipe(destination?: NodeJS.WritableStream): void;

  /** Дочитывает вход в никуда: иначе соединение ждало бы конца тела */
  resume(): void;
}

/**
 * Ответ: то, во что пишут кадрирование и отправка ошибки.
 *
 * Событие `'close'` приходит и после штатного завершения ответа, и при
 * разрыве соединения. Отличает их `writableFinished`: у разрыва ответ
 * недописан.
 */
export interface HttpSink {
  statusCode: number;

  readonly headersSent: boolean;

  readonly writableEnded: boolean;

  readonly writableFinished: boolean;

  readonly destroyed: boolean;

  setHeader(name: string, value: string | number | readonly string[]): void;

  writeHead(status: number, headers: HttpSinkHeaders): void;

  /**
   * Пишет кадр.
   *
   * Возвращает `false`, когда буфер полон: кадрирование ждёт колбэк, и
   * медленный клиент не превращает ответ в буфер в памяти сервера.
   */
  write(
    chunk: string | Buffer | Uint8Array,
    callback?: (error?: Error | null) => void,
  ): boolean;

  end(chunk?: string | Buffer | Uint8Array): void;

  /** Отправляет заголовки, не закрывая ответ: так открывается подписка SSE */
  flushHeaders(): void;

  /** Рвёт ответ посреди тела: статус уже ушёл, сменить его нечем */
  destroy(): void;

  on(event: 'close', listener: () => void): void;
}

/**
 * Обработчик одного запроса.
 *
 * `false` означает «маршрут не мой»: без этого признака два транспорта на
 * одном сокете невозможны — первый отвечал бы `404` на чужие маршруты.
 */
export type HttpRequestListener = (
  source: HttpSource,
  sink: HttpSink,
) => Promise<boolean>;

/**
 * Приёмник обработчика: единственное, что транспорту нужно от сервера.
 *
 * Реализаций две. `HttpServer` присоединяет обработчик к сокету, адаптер
 * забирает его себе и отдаёт наружу. Всё остальное — маршрутизация,
 * разбор входа, кадрирование ответа — от сокета не зависит, поэтому
 * границей транспорта служит этот один метод.
 */
export interface HttpAttach {
  attach(listener: HttpRequestListener): void;
}
