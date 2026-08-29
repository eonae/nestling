import {
  type ErrorStatus,
  type SuccessStatus,
  successStatuses,
} from './status';

/**
 * Отказ с любым кодом и любыми деталями.
 *
 * Используется там, где конкретный отказ не важен: ограничение
 * тип-параметра `E` в {@link Output}, тип аргумента `meta.fail` в рантайме,
 * список объявленных отказов декларации.
 */
export type AnyFail = Fail<string | undefined, any>;

/**
 * Запрещает отказ в слоте значения {@link Ok}.
 *
 * Проверка недистрибутивная (`[T] extends [AnyFail]`): дистрибутивная
 * пропустила бы `Order | Fail<'A'>` и ловила бы только чистый отказ.
 */
type NotFail<T> = [T] extends [AnyFail] ? never : unknown;

/**
 * Успешный ответ: статус, значение и необязательные заголовки.
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
      this.status = 'OK';
      this.value = statusOrValue as TValue;
      this.headers = valueOrHeaders as Record<string, string> | undefined;
    }
  }

  static created<T>(
    value: T & NotFail<T>,
    headers?: Record<string, string>,
  ): Ok<T> {
    return new Ok('CREATED', value, headers);
  }

  static accepted<T>(
    value: T & NotFail<T>,
    headers?: Record<string, string>,
  ): Ok<T> {
    return new Ok('ACCEPTED', value, headers);
  }

  static noContent(headers?: Record<string, string>): Ok<null> {
    return new Ok('NO_CONTENT', null, headers);
  }
}

/**
 * Опции конструктора {@link Fail}.
 *
 * `code` отвечает на вопрос «что случилось», `status` — «как ответить».
 * Код задают определения `defineFail`; у анонимного отказа кода нет.
 */
export interface FailOptions<
  TCode extends string | undefined = string | undefined,
  TDetails = unknown,
> {
  /** Машинный код отказа */
  code?: TCode;

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
 * @param TCode - Машинный код; `undefined` у анонимного отказа
 * (`Fail.notFound(...)`, `new Fail('CONFLICT', …)`). Этот параметр делает
 * `Fail<'A'>` и `Fail<'B'>` несовместимыми
 * @param TDetails - Тип деталей; выводится из схемы определения
 */
export class Fail<
  TCode extends string | undefined = string | undefined,
  TDetails = unknown,
> extends Error {
  /** Дискриминант ответа (см. {@link Ok.isFail}) */
  public readonly isFail = true as const;

  public readonly status: ErrorStatus;
  public readonly code: TCode;

  /**
   * `declare`, а не обычное поле: при `useDefineForClassFields` поле без
   * инициализатора получает own-свойство со значением `undefined`, и
   * «отказ без деталей» перестал бы отличаться от «отказ с деталями
   * `undefined`». Это различие видно при сериализации.
   */
  declare readonly details?: TDetails;

  constructor(
    status: ErrorStatus,
    message: string,
    options: FailOptions<TCode, TDetails> = {},
  ) {
    // `cause` передаётся только если задан: `{ cause: undefined }` создало
    // бы own-свойство `cause` со значением `undefined`.
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'Failure';
    this.status = status;
    this.code = options.code as TCode;

    if (options.details !== undefined) {
      (this as { details?: TDetails }).details = options.details;
    }

    // Стек без кадра конструктора (V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, Fail);
    }
  }

  /**
   * Фабрики типовых отказов.
   *
   * Создают анонимный отказ (`code: undefined`). Такой отказ не входит в
   * контракт endpoint'а, и на выходе из пайплайна он заменяется на
   * `UnknownError`. Доменные отказы объявляются через `defineFail` и
   * список `errors` декларации.
   */
  static badRequest<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('BAD_REQUEST', message, { details });
  }

  static unauthorized<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('UNAUTHORIZED', message, { details });
  }

  static forbidden<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('FORBIDDEN', message, { details });
  }

  static notFound<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('NOT_FOUND', message, { details });
  }

  static conflict<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('CONFLICT', message, { details });
  }

  static tooManyRequests<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('TOO_MANY_REQUESTS', message, { details });
  }

  static timeout<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('TIMEOUT', message, { details });
  }

  static internalError<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('INTERNAL_ERROR', message, { details });
  }

  static notImplemented<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('NOT_IMPLEMENTED', message, { details });
  }

  static serviceUnavailable<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('SERVICE_UNAVAILABLE', message, { details });
  }

  static paymentRequired<D = unknown>(
    message: string,
    details?: D,
  ): Fail<undefined, D> {
    return new Fail<undefined, D>('PAYMENT_REQUIRED', message, { details });
  }
}

/**
 * Отказ как данные: объект без прототипа (например, разобранный из JSON),
 * но с дискриминантом `isFail`.
 *
 * С этой формой работают рантайм пайплайна и предикаты определений.
 */
export interface FailData {
  readonly isFail: true;
  readonly status?: ErrorStatus;
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

/**
 * Синхронный результат хендлера: `Ok`, значение без обёртки или отказ из
 * множества `E`.
 *
 * По умолчанию `E` равно `never`: endpoint без `errors` не может вернуть
 * отказ.
 */
export type OutputSync<TValue = unknown, E extends AnyFail = never> =
  | Ok<TValue>
  | E
  | TValue;

/** Асинхронный результат хендлера (см. {@link OutputSync}) */
export type Output<TValue = unknown, E extends AnyFail = never> = Promise<
  Ok<TValue> | E | TValue
>;
