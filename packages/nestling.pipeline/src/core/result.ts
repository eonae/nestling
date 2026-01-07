import {
  type ErrorStatus,
  type SuccessStatus,
  successStatuses,
} from './status';

/**
 * Успешный результат обработки
 * Используется для возврата данных с успешным статусом
 */
export class Ok<TValue = unknown> {
  public readonly status: SuccessStatus;
  public readonly value: TValue;
  public readonly headers?: Record<string, string>;

  constructor(
    status: SuccessStatus,
    value: TValue,
    headers?: Record<string, string>,
  );
  constructor(value: TValue, headers?: Record<string, string>);
  constructor(
    statusOrValue: SuccessStatus | TValue,
    valueOrHeaders?: TValue | Record<string, string>,
    headers?: Record<string, string>,
  ) {
    const isStatus =
      typeof statusOrValue === 'string' &&
      successStatuses.includes(statusOrValue as SuccessStatus);

    if (isStatus) {
      // Первая перегрузка: (status, value, headers?)
      this.status = statusOrValue as SuccessStatus;
      this.value = valueOrHeaders as TValue;
      this.headers = headers;
    } else {
      // Вторая перегрузка: (value, headers?)
      this.status = 'OK';
      this.value = statusOrValue as TValue;
      this.headers = valueOrHeaders as Record<string, string> | undefined;
    }
  }

  static created<T>(value: T, headers?: Record<string, string>): Ok<T> {
    return new Ok('CREATED', value, headers);
  }

  static accepted<T>(value: T, headers?: Record<string, string>): Ok<T> {
    return new Ok('ACCEPTED', value, headers);
  }

  static noContent(headers?: Record<string, string>): Ok<null> {
    return new Ok('NO_CONTENT', null, headers);
  }
}

/**
 * Ошибка обработки запроса
 * Бросается как исключение и автоматически преобразуется в ResponseContext
 */
export class Fail extends Error {
  constructor(
    public readonly status: ErrorStatus,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'Failure';

    // Поддержка правильного stack trace в V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, Fail);
    }
  }

  /**
   * Фабричные методы для типовых ошибок
   */
  static badRequest(message: string, details?: unknown): Fail {
    return new Fail('BAD_REQUEST', message, details);
  }

  static unauthorized(message: string, details?: unknown): Fail {
    return new Fail('UNAUTHORIZED', message, details);
  }

  static forbidden(message: string, details?: unknown): Fail {
    return new Fail('FORBIDDEN', message, details);
  }

  static notFound(message: string, details?: unknown): Fail {
    return new Fail('NOT_FOUND', message, details);
  }

  static internalError(message: string, details?: unknown): Fail {
    return new Fail('INTERNAL_ERROR', message, details);
  }

  static notImplemented(message: string, details?: unknown): Fail {
    return new Fail('NOT_IMPLEMENTED', message, details);
  }

  static serviceUnavailable(message: string, details?: unknown): Fail {
    return new Fail('SERVICE_UNAVAILABLE', message, details);
  }

  static paymentRequired(message: string, details?: unknown): Fail {
    return new Fail('PAYMENT_REQUIRED', message, details);
  }
}

export type OutputSync<TValue = unknown> = Ok<TValue> | TValue;

export type Output<TValue = unknown> = Promise<Ok<TValue> | TValue>;
