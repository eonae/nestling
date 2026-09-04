import {
  type Category,
  categoryOf,
  type FailCode,
  type SuccessStatus,
  successStatuses,
} from './status.js';

/**
 * Отказ с любым кодом и любыми деталями.
 *
 * Используется там, где конкретный отказ не важен: ограничение
 * тип-параметра `E` в `Output`, список объявленных отказов декларации.
 */
export type AnyFail = Fail<FailCode, any>;

/**
 * Запрещает отказ в слоте значения {@link Ok}.
 *
 * Проверка недистрибутивная (`[T] extends [AnyFail]`): дистрибутивная
 * пропустила бы `Order | Fail<'A'>` и ловила бы только чистый отказ.
 */
type NotFail<T> = [T] extends [AnyFail] ? never : unknown;

/**
 * Успешный ответ: статус, значение и необязательные заголовки.
 *
 * Заголовки — метаданные ответа, не зависящие от транспорта. HTTP пишет
 * их в заголовки ответа, NATS — в заголовки ответного сообщения, CLI
 * отбрасывает.
 */
export class Ok<TValue = unknown> {
  /**
   * Дискриминант ответа; у `Fail` он равен `true`. Обычное свойство,
   * поэтому переживает сериализацию.
   */
  public readonly isFail = false as const;

  public readonly status: SuccessStatus;
  public readonly value: TValue;
  public readonly headers?: Record<string, string>;

  /**
   * `new Ok(fail)` не компилируется: тип значения — `TValue &
   * NotFail<TValue>`. Пересечение, а не условный тип: из `TValue` вывод
   * типа работает, из условного типа — нет.
   */
  constructor(
    status: SuccessStatus,
    value: TValue & NotFail<TValue>,
    headers?: Record<string, string>,
  );
  constructor(
    value: TValue & NotFail<TValue>,
    headers?: Record<string, string>,
  );
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
      this.status = 'ok';
      this.value = statusOrValue as TValue;
      this.headers = valueOrHeaders as Record<string, string> | undefined;
    }
  }

  static created<T>(
    value: T & NotFail<T>,
    headers?: Record<string, string>,
  ): Ok<T> {
    return new Ok('created', value, headers);
  }

  static accepted<T>(
    value: T & NotFail<T>,
    headers?: Record<string, string>,
  ): Ok<T> {
    return new Ok('accepted', value, headers);
  }

  static noContent(headers?: Record<string, string>): Ok<null> {
    return new Ok('no_content', null, headers);
  }
}

/**
 * Опции конструктора {@link Fail}: детали и исходная ошибка.
 */
export interface FailOptions<TDetails = unknown> {
  /** Детали отказа; попадают в тело ответа */
  details?: TDetails;

  /** Исходная ошибка (`Error.cause`); в тело ответа не попадает */
  cause?: unknown;
}

/**
 * Отказ: ожидаемая ошибка обработки запроса.
 *
 * Это значение, а не только исключение: возврат `Fail` из хендлера рантайм
 * обрабатывает так же, как `throw`. Класс наследует `Error` ради стека
 * вызовов при `throw`. Отказ распознаётся по `code` и `isFail`, а не по
 * `instanceof`: после десериализации прототип теряется.
 *
 * У отказа одна ось — `code`. Категория (первый сегмент кода) выводится
 * из него и отдельно не хранится.
 *
 * @param TCode - Код отказа. Этот параметр делает `Fail<'not_found:a'>` и
 * `Fail<'not_found:b'>` несовместимыми
 * @param TDetails - Тип деталей; выводится из схемы определения
 */
export class Fail<
  TCode extends FailCode = FailCode,
  TDetails = unknown,
> extends Error {
  /** Дискриминант ответа (см. {@link Ok.isFail}) */
  public readonly isFail = true as const;

  /** Машинный код: `category[:detail…]` */
  public readonly code: TCode;

  /**
   * `declare`, а не обычное поле: при `useDefineForClassFields` поле без
   * инициализатора получает own-свойство со значением `undefined`, и
   * «отказ без деталей» перестал бы отличаться от «отказ с деталями
   * `undefined`». Это различие видно при сериализации.
   */
  declare readonly details?: TDetails;

  constructor(
    code: TCode,
    message: string,
    options: FailOptions<TDetails> = {},
  ) {
    // `cause` передаётся только если задан: `{ cause: undefined }` создало
    // бы own-свойство `cause` со значением `undefined`.
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'Failure';
    this.code = code;

    if (options.details !== undefined) {
      (this as { details?: TDetails }).details = options.details;
    }

    // Стек без кадра конструктора (V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, Fail);
    }
  }

  /**
   * Категория отказа: первый сегмент кода.
   *
   * Аксессор, а не поле: в сериализованный отказ категория не попадает и
   * восстанавливается из кода на другой стороне.
   */
  get category(): Category {
    return categoryOf(this.code);
  }

  /**
   * Фабрики анонимных отказов.
   *
   * Код такого отказа равен категории. В `errors:` он не объявлен, и на
   * выходе из пайплайна заменяется на `InternalError`, если декларация не
   * перечисляет определение с тем же кодом. Доменные отказы объявляются
   * через `makeFail` и список `errors:` декларации.
   */
  static badRequest<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'bad_request', D> {
    return new Fail('bad_request', message, { details });
  }

  static unauthorized<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'unauthorized', D> {
    return new Fail('unauthorized', message, { details });
  }

  static forbidden<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'forbidden', D> {
    return new Fail('forbidden', message, { details });
  }

  static notFound<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'not_found', D> {
    return new Fail('not_found', message, { details });
  }

  static conflict<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'conflict', D> {
    return new Fail('conflict', message, { details });
  }

  static tooManyRequests<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'too_many_requests', D> {
    return new Fail('too_many_requests', message, { details });
  }

  static timeout<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'timeout', D> {
    return new Fail('timeout', message, { details });
  }

  static internalError<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'internal_error', D> {
    return new Fail('internal_error', message, { details });
  }

  static notImplemented<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'not_implemented', D> {
    return new Fail('not_implemented', message, { details });
  }

  static serviceUnavailable<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'service_unavailable', D> {
    return new Fail('service_unavailable', message, { details });
  }

  static paymentRequired<D = unknown>(
    message: string,
    details?: D,
  ): Fail<'payment_required', D> {
    return new Fail('payment_required', message, { details });
  }
}

/**
 * Отказ как данные: объект без прототипа (например, разобранный из JSON),
 * но с дискриминантом `isFail`.
 *
 * С этой формой работают рантайм пайплайна и предикаты определений.
 * Категории здесь нет: её даёт `categoryOf(code)`.
 */
export interface FailData {
  readonly isFail: true;
  readonly code?: string;
  readonly message?: string;
  readonly details?: unknown;
}

/**
 * Проверяет, что значение — отказ, по дискриминанту `isFail`, а не по
 * `instanceof`: отказ, созданный локально, и отказ, полученный по сети,
 * обрабатываются одинаково.
 */
export function isFail(value: unknown): value is FailData {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isFail?: unknown }).isFail === true
  );
}
