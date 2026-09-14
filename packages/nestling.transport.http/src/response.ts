import { HTTP_TRANSPORT_NAME } from './token.js';

import type {
  AnyFail,
  AnyFailDefinition,
  AnyOutput,
  DeclaredOutputSync,
  DeclaredStatuses,
  InferOutput,
  OutputSync,
  RedirectStatus,
  SuccessStatus,
  TransportResponse,
} from '@nestlingjs/operations';
import { Ok, TRANSPORT_RESPONSE } from '@nestlingjs/operations';

/**
 * Статус редиректа объявлен рядом с bind-картой в `@nestlingjs/operations`;
 * здесь он реэкспортирован, чтобы автор декларации брал его оттуда же,
 * откуда `httpEndpoint`.
 */
export type { RedirectStatus } from '@nestlingjs/operations';

/** Статус редиректа по умолчанию: ни вызов, ни декларация его не задали */
export const DEFAULT_REDIRECT_STATUS: RedirectStatus = 302;

/**
 * Запрещает отказ в слоте значения (см. `Ok`).
 *
 * Проверка недистрибутивная (`[T] extends [AnyFail]`): дистрибутивная
 * пропустила бы `Order | Fail<'A'>`.
 */
type NotFail<T> = [T] extends [AnyFail] ? never : unknown;

/**
 * Cookie ответа. Каждое значение уходит отдельным заголовком `Set-Cookie`.
 *
 * Разбора входящих cookie в V1 нет: заголовок `Cookie` читается из
 * `meta.http.headers`.
 */
export interface Cookie {
  /** Имя cookie */
  readonly name: string;

  /** Значение; транспорт пишет его как есть */
  readonly value: string;

  /** Время жизни в секундах */
  readonly maxAge?: number;

  /** Момент истечения */
  readonly expires?: Date;

  /** Путь, для которого cookie отправляется браузером */
  readonly path?: string;

  /** Домен, для которого cookie отправляется браузером */
  readonly domain?: string;

  /** Только по HTTPS */
  readonly secure?: boolean;

  /** Недоступна из JavaScript страницы */
  readonly httpOnly?: boolean;

  /** Политика отправки при межсайтовых запросах */
  readonly sameSite?: 'strict' | 'lax' | 'none';
}

/** Заголовки и cookie ответа */
export interface HttpResponseOptions {
  /**
   * Заголовки ответа. Имя приводится к нижнему регистру до слияния,
   * поэтому заголовок хендлера перекрывает заголовок формы независимо от
   * регистра.
   */
  headers?: Record<string, string>;

  /** Cookie ответа; каждая уходит отдельным заголовком `Set-Cookie` */
  cookies?: readonly Cookie[];
}

/** Заголовки, cookie и статус редиректа */
export interface RedirectOptions extends HttpResponseOptions {
  /**
   * Статус редиректа. Без него берётся объявленный декларацией
   * (`redirect: 303`), без обоих — `302`.
   */
  status?: RedirectStatus;
}

/**
 * Метаданные HTTP-ответа: то, что конверт доносит от хендлера до
 * транспорта.
 *
 * Ядро значение не читает — оно доходит до `framing.ts` полем
 * `transport.meta` контекста ответа.
 */
export interface HttpResponseMeta {
  /** Заголовки ответа */
  readonly headers?: Record<string, string>;

  /** Cookie ответа */
  readonly cookies?: readonly Cookie[];

  /** Значение заголовка `Location`; есть только у редиректа */
  readonly location?: string;

  /** Статус редиректа, заданный вызовом */
  readonly status?: RedirectStatus;
}

/**
 * Метка конверта: объявлена отдельно от класса, потому что имя ей даёт
 * символ, а декларация выводится из одного файла и такого имени не
 * выражает. Ставится конструктором — поле остаётся собственным, как было.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface HttpResponse {
  /** Метка конверта; по ней его распознаёт рантайм пайплайна */
  readonly [TRANSPORT_RESPONSE]: true;
}

/**
 * HTTP-форма ответа: результат плюс заголовки, cookie и редирект.
 *
 * Значение реализует конверт транспортного ответа с именем `http`:
 * пайплайн разбирает `result` тем же кодом, что и обычный ответ, а `meta`
 * доносит до HTTP-транспорта. Другой транспорт, получив этот конверт,
 * отвечает `internal_error`.
 *
 * Конструктор приватный: ответ создаётся `of` или `redirect`.
 *
 * @example Заголовок и cookie
 * ```typescript
 * return HttpResponse.of(Ok.created(user), {
 *   headers: { Location: `/users/${user.id}` },
 *   cookies: [{ name: 'sid', value: session.id, httpOnly: true }],
 * });
 * ```
 *
 * @example Редирект
 * ```typescript
 * return HttpResponse.redirect('/app', { status: 303 });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class HttpResponse<
  TValue = unknown,
  TStatus extends SuccessStatus = SuccessStatus,
> implements TransportResponse<TValue, TStatus>
{
  /** Имя транспорта, который понимает `meta` */
  readonly transport: string = HTTP_TRANSPORT_NAME;

  private constructor(
    readonly result: OutputSync<TValue, AnyFail, TStatus>,
    readonly meta: HttpResponseMeta,
  ) {
    Object.assign(this, { [TRANSPORT_RESPONSE]: true });
  }

  /**
   * Обычный ответ с заголовками и cookie.
   *
   * @param result - `Ok` со статусом успеха или само значение
   * @param options - Заголовки и cookie ответа
   */
  static of<T, S extends SuccessStatus = 'ok'>(
    result: Ok<T, S> | (T & NotFail<T>),
    options: HttpResponseOptions = {},
  ): HttpResponse<T, S> {
    return new HttpResponse<T, S>(result as OutputSync<T, AnyFail, S>, options);
  }

  /**
   * Редирект: заголовок `Location` и статус 3xx.
   *
   * Декларация обязана объявить поле `redirect`; иначе ответ —
   * `internal_error`.
   *
   * @param location - Значение заголовка `Location`
   * @param options - Статус, заголовки и cookie ответа
   */
  static redirect(
    location: string,
    options: RedirectOptions = {},
  ): HttpResponse<never, 'no_content'> {
    // Значение редиректа — пустой ответ: тело у 3xx не пишется, а статус
    // ставит транспорт по `location`
    return new HttpResponse<never, 'no_content'>(Ok.noContent() as never, {
      ...options,
      location,
    });
  }
}

/**
 * Синхронный результат HTTP-хендлера: обычный результат плюс HTTP-форма
 * ответа.
 */
export type HttpOutputSync<
  TValue = unknown,
  E extends AnyFailDefinition | AnyFail = never,
  S extends SuccessStatus = 'ok',
> = OutputSync<TValue, E, S> | HttpResponse<TValue, S>;

/**
 * Асинхронный результат HTTP-хендлера (см. {@link HttpOutputSync}).
 *
 * @example
 * ```typescript
 * async handle(input: Credentials, meta: HttpHandlerMeta): HttpOutput<never> {
 *   return HttpResponse.redirect('/app', { cookies: [session] });
 * }
 * ```
 */
export type HttpOutput<
  TValue = unknown,
  E extends AnyFailDefinition | AnyFail = never,
  S extends SuccessStatus = 'ok',
> = Promise<HttpOutputSync<TValue, E, S>>;

/**
 * Результат HTTP-хендлера: объявленные исходы плюс HTTP-форма ответа.
 *
 * Конверт `HttpResponse` несёт тот же статус: заголовки и cookie ответ
 * получает от транспорта, а исход по-прежнему объявляет декларация.
 *
 * Тип один на обе формы хендлера: его читает слот `handler` анонимной
 * декларации и интерфейс `HttpHandler` класса-хендлера операции.
 */
export type HttpDeclaredResult<
  O extends AnyOutput,
  E extends AnyFailDefinition | AnyFail,
  S extends SuccessStatus,
> =
  | DeclaredOutputSync<O, E, S>
  | HttpResponse<InferOutput<O>, DeclaredStatuses<O, S>>;
