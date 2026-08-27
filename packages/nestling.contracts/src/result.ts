import {
  type ErrorStatus,
  type SuccessStatus,
  successStatuses,
} from './status';

/**
 * Отказ с любым кодом и любыми деталями.
 *
 * Используется там, где конкретный отказ несущественен: ограничение
 * тип-параметра `E` в {@link Output}, тип аргумента `meta.fail` в рантайме,
 * список объявленных отказов декларации.
 */
export type AnyFail = Fail<string | undefined, any>;

/**
 * «Не отказ» — сторож слота значения у {@link Ok}.
 *
 * Проверка намеренно **недистрибутивная** (`[T] extends [AnyFail]`):
 * дистрибуция по юниону схлопнула бы `Order | Fail<'A'>` обратно в
 * разрешённое, и запрет ловил бы только голый отказ.
 */
type NotFail<T> = [T] extends [AnyFail] ? never : unknown;

/**
 * Успешный результат обработки
 * Используется для возврата данных с успешным статусом
 */
export class Ok<TValue = unknown> {
  /**
   * Дискриминант результата: обычное свойство значения, а не `instanceof`.
   * Симметрично `Fail.isFail === true`; переживает сериализацию.
   */
  public readonly isFail = false as const;

  public readonly status: SuccessStatus;
  public readonly value: TValue;
  public readonly headers?: Record<string, string>;

  /**
   * Слот значения закрыт для отказа (`TValue & NotFail<TValue>`): `new
   * Ok(fail)` — ошибка компиляции. Пересечение, а не условный тип целиком:
   * из голого `TValue` вывод работает, из условного — нет.
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
 * `code` — стабильный машинный код («что именно случилось»), ось,
 * ортогональная статусу («как отвечать транспорту»). Проставляется
 * определениями `defineFail`; анонимный отказ кода не несёт.
 */
export interface FailOptions<
  TCode extends string | undefined = string | undefined,
  TDetails = unknown,
> {
  /** Машинный код отказа */
  code?: TCode;

  /** Детали отказа — уезжают в тело ответа */
  details?: TDetails;

  /** Исходная ошибка (ES2022 `Error.cause`); в тело ответа НЕ попадает */
  cause?: unknown;
}

/**
 * Ошибка обработки запроса.
 *
 * Значение, а не только исключение: возврат `Fail` из хендлера рантайм
 * трактует так же, как бросок. `extends Error` оставлен ради бесплатного
 * стека на throw-пути; идентичность отказа определяется **кодом**, а не
 * `instanceof` — на десериализованном значении класс мёртв, а `isFail` и
 * `code` выживают.
 *
 * @param TCode - машинный код; `undefined` у анонимного отказа
 * (`Fail.notFound(...)`, `new Fail('CONFLICT', …)`). Именно этот параметр
 * даёт структурную несовместимость `Fail<'A'>` и `Fail<'B'>`.
 * @param TDetails - тип деталей (выводится из схемы определения)
 */
export class Fail<
  TCode extends string | undefined = string | undefined,
  TDetails = unknown,
> extends Error {
  /** Дискриминант результата (см. {@link Ok.isFail}) */
  public readonly isFail = true as const;

  public readonly status: ErrorStatus;
  public readonly code: TCode;

  /**
   * `declare`, а не обычное поле: при `useDefineForClassFields` объявление
   * без инициализатора всё равно заводит own-свойство со значением
   * `undefined`, и «отказ без деталей» переставал бы отличаться от «отказ
   * с деталями `undefined`». Значение отказа обязано быть точным — оно
   * уезжает по проводу.
   */
  declare readonly details?: TDetails;

  constructor(
    status: ErrorStatus,
    message: string,
    options: FailOptions<TCode, TDetails> = {},
  ) {
    // `cause` ставится только когда он есть: `{ cause: undefined }`
    // завело бы одноимённое own-свойство и на пустом месте.
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

    // Поддержка правильного stack trace в V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, Fail);
    }
  }

  /**
   * Фабричные методы для типовых ошибок.
   *
   * Дают **анонимный** отказ (`code: undefined`): такой не входит в
   * контракт ручки и нормализуется стражем границы в `UnknownError`.
   * Канон доменного отказа — `defineFail` + `errors:` декларации.
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
 * Отказ как **данные**: значение, потерявшее прототип (разобранное из
 * JSON, приехавшее по проводу), но сохранившее дискриминант.
 *
 * Форма, с которой работают рантайм пайплайна и предикаты определений:
 * `instanceof` на таком значении ложен, `isFail` — нет.
 */
export interface FailData {
  readonly isFail: true;
  readonly status?: ErrorStatus;
  readonly code?: string;
  readonly message?: string;
  readonly details?: unknown;
}

/**
 * Распознаёт отказ по дискриминанту, а не по `instanceof`.
 *
 * Единственный способ различения отказов в рантайме ядра: пайплайн должен
 * одинаково относиться к отказу, созданному локально, и к отказу,
 * приехавшему данными.
 */
export function isFail(value: unknown): value is FailData {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isFail?: unknown }).isFail === true
  );
}

/**
 * Синхронный результат хендлера: `Ok`, голое значение или отказ из
 * объявленного множества `E`.
 *
 * `E` по умолчанию **пусто** (`never`): ручка без `errors:` вернуть отказ
 * не может — иначе типы разрешали бы то, что граница гарантированно
 * превратит в `UnknownError`.
 */
export type OutputSync<TValue = unknown, E extends AnyFail = never> =
  | Ok<TValue>
  | E
  | TValue;

/** Асинхронный результат хендлера (см. {@link OutputSync}) */
export type Output<TValue = unknown, E extends AnyFail = never> = Promise<
  Ok<TValue> | E | TValue
>;
