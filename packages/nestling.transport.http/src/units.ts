import type { HttpStartContext } from './helpers.js';

import type { FinallyUnitFn, Logger, PreUnitFn } from '@nestling/app';

/**
 * Кладёт значение заголовка запроса в контекст под тем же именем.
 *
 * Переименования нет: имя поля равно имени заголовка, и правило читается
 * без исключений. Заголовка может не быть, поэтому тип поля —
 * `string | undefined`.
 *
 * @param name - Имя заголовка в нижнем регистре, как его даёт `node:http`
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline<HttpStartContext>().pre(withHeader('x-tenant'));
 * // хендлер читает meta['x-tenant']
 * ```
 */
export function withHeader<const Name extends string>(
  name: Name,
): PreUnitFn<HttpStartContext, Record<Name, string | undefined>> {
  return (ctx) =>
    ({ [name]: ctx.input.http.headers[name] }) as Record<
      Name,
      string | undefined
    >;
}

/**
 * Кладёт адрес сокета в поле `clientIp`.
 *
 * Заголовки прокси юнит не читает: за прокси это адрес прокси. Разбор
 * `X-Forwarded-For` пишет приложение — доверять заголовку можно только
 * зная свою сеть.
 */
export function withClientIp(): PreUnitFn<
  HttpStartContext,
  { clientIp: string | undefined }
> {
  return (ctx) => ({ clientIp: ctx.input.http.ip });
}

/**
 * Пишет строку доступа в фазе `.finally`: метод, путь, статус,
 * длительность и счётчики байтов.
 *
 * Логгер приходит аргументом, как у `withRequestLogging`: так юнит
 * остаётся функцией и не растит `TNeeds` пайплайна.
 *
 * @param logger - Логгер; обычно член `Logger$(scope)`
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline<HttpStartContext>().finally(httpAccessLog(logger));
 * ```
 */
export function httpAccessLog(logger: Logger): FinallyUnitFn<HttpStartContext> {
  return (outcome, response, ctx) => {
    const { http } = ctx.input;

    logger.info('request completed', {
      method: http.method,
      url: http.url,
      status: response.status,
      outcome,
      duration: Date.now() - http.receivedAt,
      bytesIn: ctx.summary.bytesIn ?? 0,
      bytesOut: ctx.summary.bytesOut ?? 0,
    });
  };
}
