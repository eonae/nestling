/**
 * Тело отказа HTTP-границы: документ RFC 9457
 * (`application/problem+json`).
 *
 * Модуль собирает документ и разбирает его обратно. Он лежит в пакете
 * операций, а не в транспорте, потому что читателей документа двое и
 * один из них — типизированный клиент: клиент работает в браузере и
 * серверный пакет тянуть не может.
 *
 * Код HTTP-ответа модулю передаёт вызывающий: таблица перевода
 * категории в код живёт в `@nestlingjs/transport.http`, и второй её
 * копии здесь нет.
 */

import { type Category, categoryOf } from '../status.js';

/** Медиатип тела отказа */
export const PROBLEM_MEDIA_TYPE = 'application/problem+json';

/**
 * Префикс типа проблемы.
 *
 * Голый код (`not_found:user`) идентификатором не проходит: по RFC 3986
 * он читается как схема `not_found` с путём `user`, а подчёркивание в
 * схеме запрещено. Префикс делает из кода URN.
 */
export const PROBLEM_TYPE_PREFIX = 'urn:error:';

/**
 * Документ RFC 9457.
 *
 * `details` и `stack` — расширения: первое несёт детали отказа, второе
 * пишется только при `exposeErrorDetails`.
 */
export interface ProblemDocument {
  /** Тип проблемы: код отказа с префиксом `urn:error:` */
  type: string;

  /** Фраза статуса HTTP по категории отказа */
  title: string;

  /** Код HTTP-ответа числом */
  status: number;

  /** Сообщение отказа */
  detail: string;

  /** Детали отказа; расширение */
  details?: unknown;

  /** Стек необработанной ошибки; расширение */
  stack?: string;
}

/**
 * Отказ в форме данных: то, что несёт контекст ответа границы.
 *
 * Тип объявлен структурно, потому что сам `ErrorDetails` живёт в
 * `@nestlingjs/app`, а пакет операций от серверного кода не зависит.
 */
export interface ErrorDetailsLike {
  /** Сообщение отказа */
  error: string;

  /** Машинный код: `category[:detail…]` */
  code: string;

  /** Детали отказа */
  details?: unknown;

  /** Стек необработанной ошибки */
  stack?: string;
}

/**
 * Код отказа в тип проблемы.
 *
 * @param code - Код отказа (`not_found:user`)
 * @returns Тип проблемы (`urn:error:not_found:user`)
 */
export function problemTypeOf(code: string): string {
  return `${PROBLEM_TYPE_PREFIX}${code}`;
}

/**
 * Тип проблемы обратно в код отказа.
 *
 * Не строка или строка без префикса дают `undefined`: документ прислал
 * чужой сервис, и кода отказа в нём нет.
 *
 * @param type - Член `type` документа
 * @returns Код отказа либо `undefined`
 */
export function failCodeOf(type: unknown): string | undefined {
  if (typeof type !== 'string' || !type.startsWith(PROBLEM_TYPE_PREFIX)) {
    return undefined;
  }

  return type.slice(PROBLEM_TYPE_PREFIX.length);
}

/**
 * Фразы статуса HTTP по категориям отказа.
 *
 * Тип `Record<Category, string>` обязывает: новая категория не пройдёт
 * мимо таблицы. Фразы — те же, что `node:http` пишет в строке статуса.
 */
const TITLES: Record<Category, string> = {
  bad_request: 'Bad Request',
  unauthorized: 'Unauthorized',
  payment_required: 'Payment Required',
  forbidden: 'Forbidden',
  not_found: 'Not Found',
  conflict: 'Conflict',
  payload_too_large: 'Payload Too Large',
  too_many_requests: 'Too Many Requests',
  internal_error: 'Internal Server Error',
  not_implemented: 'Not Implemented',
  service_unavailable: 'Service Unavailable',
  timeout: 'Gateway Timeout',
};

/**
 * Заголовок типа проблемы: фраза статуса HTTP.
 *
 * Стандарт требует от `title` описания **типа** проблемы, одного на все
 * случаи этого типа; конкретный случай описывает `detail`. Категория вне
 * перечня даёт фразу `internal_error`: такой отказ граница и переводит в
 * 500.
 *
 * @param category - Категория отказа
 * @returns Фраза статуса
 */
export function problemTitleOf(category: Category): string {
  return TITLES[category] ?? TITLES.internal_error;
}

/**
 * Документ из деталей отказа и кода ответа.
 *
 * `details` и `stack` пишутся только при наличии: у документа без них не
 * должно появляться членов со значением `undefined`.
 *
 * @param error - Детали отказа из контекста ответа
 * @param status - Код HTTP-ответа
 * @returns Документ RFC 9457
 */
export function problemOf(
  error: ErrorDetailsLike,
  status: number,
): ProblemDocument {
  const document: ProblemDocument = {
    type: problemTypeOf(error.code),
    title: problemTitleOf(categoryOf(error.code)),
    status,
    detail: error.error,
  };

  if (error.details !== undefined) {
    document.details = error.details;
  }
  if (error.stack !== undefined) {
    document.stack = error.stack;
  }

  return document;
}
