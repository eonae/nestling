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
 * Успешный ответ: статус и значение.
 *
 * Статус входит в тип (`Ok<User, 'created'>`), потому что его ограничивает
 * декларация: результат хендлера допускает только объявленные исходы.
 * Литерал статуса выводится в точке создания значения — перегрузкой
 * конструктора или фабрикой.
 *
 * Заголовков у `Ok` нет: они принадлежат HTTP, а не результату обработки.
 * Заголовки, cookie и редирект задаёт форма ответа своего транспорта —
 * `HttpResponse` в `@nestlingjs/transport.http`.
 */
export interface Ok<TValue = unknown, TStatus extends SuccessStatus = 'ok'> {
  /**
   * Дискриминант ответа; у `Fail` он равен `true`. Обычное свойство,
   * поэтому переживает сериализацию.
   */
  readonly isFail: false;

  readonly status: TStatus;
  readonly value: TValue;
}

/**
 * Успешный ответ с любым статусом.
 *
 * Нужен там, где статус не важен: рантайм пайплайна, транспорт и тесты
 * работают с результатом любого исхода, а `Ok<T>` означает ровно `'ok'`.
 */
export type AnyOk<TValue = any> = Ok<TValue, SuccessStatus>;

/**
 * Конструктор `Ok`.
 *
 * Интерфейс, а не сигнатуры на классе: статус обязан выводиться из
 * аргумента, а тип-параметр класса компилятор выводит ещё и из ожидаемого
 * типа. У декларации с развилкой ожидаемый тип — юнион исходов, и
 * `new Ok(value)` получал бы оттуда весь набор статусов вместо `'ok'`.
 */
export interface OkConstructor {
  /**
   * `new Ok(fail)` не компилируется: тип значения — `TValue &
   * NotFail<TValue>`. Пересечение, а не условный тип: из `TValue` вывод
   * типа работает, из условного типа — нет.
   */
  new <TValue>(value: TValue & NotFail<TValue>): Ok<TValue, 'ok'>;
  new <TValue, TStatus extends SuccessStatus>(
    status: TStatus,
    value: TValue & NotFail<TValue>,
  ): Ok<TValue, TStatus>;

  created<T>(value: T & NotFail<T>): Ok<T, 'created'>;
  accepted<T>(value: T & NotFail<T>): Ok<T, 'accepted'>;
  noContent(): Ok<null, 'no_content'>;

  readonly prototype: AnyOk;
}

/** Реализация {@link Ok}; наружу её заменяет {@link OkConstructor} */
class OkValue<TValue = unknown, TStatus extends SuccessStatus = SuccessStatus>
  implements Ok<TValue, TStatus>
{
  public readonly isFail = false as const;

  public readonly status: TStatus;
  public readonly value: TValue;

  constructor(statusOrValue: TStatus | TValue, value?: TValue) {
    const isStatus =
      typeof statusOrValue === 'string' &&
      successStatuses.includes(statusOrValue as SuccessStatus);

    if (isStatus) {
      // Первая перегрузка: (status, value)
      this.status = statusOrValue as TStatus;
      this.value = value as TValue;
    } else {
      // Вторая перегрузка: (value)
      this.status = 'ok' as TStatus;
      this.value = statusOrValue as TValue;
    }
  }

  static created<T>(value: T): Ok<T, 'created'> {
    return new OkValue('created', value);
  }

  static accepted<T>(value: T): Ok<T, 'accepted'> {
    return new OkValue('accepted', value);
  }

  static noContent(): Ok<null, 'no_content'> {
    return new OkValue('no_content', null);
  }
}

/**
 * Успешный ответ: `new Ok(value)`, `new Ok('created', value)` и фабрики
 * остальных статусов.
 */
export const Ok: OkConstructor = OkValue as unknown as OkConstructor;

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
