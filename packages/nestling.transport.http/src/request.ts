import type { HttpOutput } from './response.js';

import type { HandlerMeta } from '@nestling/app';
import type {
  AnyOperation,
  InputOf,
  OperationFailsOf,
  OutputOf,
} from '@nestling/operations';

/**
 * HTTP-запрос в стартовом контексте.
 *
 * Транспорт кладёт значение под ключом `http` до первого `.pre`-юнита,
 * поэтому его видят и юниты, и хендлер анонимной декларации. Объект
 * собирается из уже прочитанных значений: заголовки не копируются.
 */
export interface HttpRequest {
  /** Метод запроса, как прислан клиентом */
  readonly method: string;

  /** Путь с query-строкой, как прислан клиентом */
  readonly url: string;

  /** Заголовки запроса; имена в нижнем регистре, как их даёт `node:http` */
  readonly headers: Readonly<Record<string, string>>;

  /** Адрес сокета; у запроса через прокси это адрес прокси */
  readonly ip?: string;
}

/**
 * Второй параметр HTTP-хендлера: `HandlerMeta` плюс запрос.
 *
 * Тип допустим только там, где адрес объявлен транспортом: в анонимной
 * форме `httpEndpoint`. В `implement` и в форме с `operation:` хендлер с
 * таким `meta` не компилируется.
 */
export interface HttpHandlerMeta extends HandlerMeta {
  /** Запрос, из которого исполняется endpoint */
  readonly http: HttpRequest;
}

/**
 * Интерфейс HTTP-хендлера операции.
 *
 * Повторяет `Handler<C>` из `@nestling/app` с двумя отличиями: `meta`
 * содержит запрос, а результат допускает `HttpResponse`. Класс с этим
 * интерфейсом на шину не переносится, и это видно при компиляции.
 *
 * @param C - Тип операции (`typeof Login`)
 *
 * @example
 * ```typescript
 * @Handler([Sessions])
 * export class LoginHandler implements HttpHandler<typeof Login> {
 *   constructor(private sessions: Sessions) {}
 *   async handle(input: Credentials, meta: HttpHandlerMeta) { … }
 * }
 * ```
 */
export interface HttpHandler<C extends AnyOperation> {
  handle(
    input: InputOf<C>,
    meta: HttpHandlerMeta,
  ): HttpOutput<OutputOf<C>, OperationFailsOf<C>>;
}
