import type { AnyInput, EmptyInput } from './io/io.js';
import type {
  ErrorDetails,
  ExtendableContext,
  ResponseContext,
} from './types/context.js';
/**
 * Type helpers
 */
import type {
  AnyAddition,
  IMiddleware,
  MiddlewareFn,
  MiddlewareInstanceOrFunction,
} from './types/middleware.before.js';
import { normalizeMiddleware } from './types/middleware.before.js';
import type { Output, OutputSync } from './result.js';
import { Fail, Ok } from './result.js';

/**
 * Опции выполнения pipeline.
 *
 * exposeErrorDetails — раскрывать ли клиенту детали НЕобработанных ошибок
 * (не `Fail`): `error.message` и `stack`. По умолчанию `false` — в тело
 * уходит только generic-сообщение. Политика раскрытия — свойство окружения
 * (транспорт/приложение), поэтому передаётся при вызове, а не хранится в
 * самом (переиспользуемом) Pipeline.
 */
export interface ExecuteOptions {
  exposeErrorDetails?: boolean;
}

type OverlapKeys<A, B> = keyof A & keyof B;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Общие ключи, у которых типы в A и B не идентичны.
 *
 * Повторное добавление поля с тем же типом (например, два withTiming
 * в одной цепочке) конфликтом не считается: input от этого не меняется.
 */
type ConflictingKeys<A, B> = {
  [K in OverlapKeys<A, B>]: [A[K], B[K]] extends [B[K], A[K]] ? never : K;
}[OverlapKeys<A, B>];

/**
 * Проверяет совместимость TReq и TAdd с TCurrentInput
 */
type CheckMiddlewareCompatibility<TCurrentInput, TReq, TAdd, M> = [
  TCurrentInput,
] extends [TReq]
  ? [ConflictingKeys<TCurrentInput, TAdd>] extends [never]
    ? M
    : {
        ERROR: 'Middleware is overriding fields in input';
        CONFLICTING_KEYS: ConflictingKeys<TCurrentInput, TAdd>;
        CURRENT_INPUT: Simplify<TCurrentInput>;
        MIDDLEWARE_ADDITION: TAdd;
      }
  : {
      ERROR: 'Input is not assignable to middleware input';
      CURRENT_INPUT: Simplify<TCurrentInput>;
      MIDDLEWARE_EXPECTS: TReq;
    };

/**
 * Валидирует совместимость middleware с текущим input
 */
type ValidateMiddleware<TCurrentInput extends AnyInput, M> =
  M extends MiddlewareFn<infer TReq, infer TAdd>
    ? CheckMiddlewareCompatibility<TCurrentInput, TReq, TAdd, M>
    : M extends IMiddleware<infer TReq, infer TAdd>
      ? CheckMiddlewareCompatibility<TCurrentInput, TReq, TAdd, M>
      : never;

/**
 * Middleware, ничего не добавляющий в input (TAddition = undefined),
 * не должен менять тип pipeline: undefined/never приводятся к {}.
 */
type NormalizeAddition<TAdd> = [TAdd] extends [never]
  ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {}
  : TAdd extends AnyAddition
    ? TAdd
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {};

/**
 * Извлекает TAddition из middleware
 */
type ExtractAddition<M> =
  M extends MiddlewareFn<any, infer TAdd>
    ? NormalizeAddition<TAdd>
    : M extends IMiddleware<any, infer TAdd>
      ? NormalizeAddition<TAdd>
      : never;

/**
 * Типизированный pipeline
 *
 * TInput - тип input-объекта, накопленного цепочкой middleware
 * (начинается с EmptyInput, каждый .use() добавляет поля своего middleware).
 *
 * Pipeline иммутабельный: каждый .use() возвращает новый экземпляр.
 * Это позволяет безопасно переиспользовать базовые pipeline'ы.
 */
export class Pipeline<TInput extends AnyInput> {
  /**
   * Приватный конструктор - создание только через static методы
   */
  private constructor(
    private readonly middlewares: ((
      ctx: any,
    ) => Promise<AnyAddition | undefined>)[] = [],
  ) {}

  /**
   * Создаёт пустой pipeline с пустым meta
   */
  static empty(): Pipeline<EmptyInput> {
    return new Pipeline([]);
  }

  use<M extends MiddlewareInstanceOrFunction<any, any>>(
    middleware: ValidateMiddleware<TInput, M>,
  ): Pipeline<TInput & ExtractAddition<M>> {
    return new Pipeline([
      ...this.middlewares,
      normalizeMiddleware(middleware as M),
    ]);
  }

  /**
   * Выполняет pipeline с handler
   *
   * @param handler - бизнес-логика endpoint (получает payload и meta отдельно)
   * @param ctx - начальный контекст от транспорта
   */
  async executeWithHandler<TOutput>(
    handler: (
      payload: TInput extends { payload: infer P } ? P : undefined,
      meta: (TInput extends { payload: unknown }
        ? Omit<TInput, 'payload'>
        : TInput) & { signal: AbortSignal },
    ) => OutputSync<TOutput> | Output<TOutput>,
    ctx: ExtendableContext<TInput>,
    options: ExecuteOptions = {},
  ): Promise<ResponseContext<TOutput>> {
    try {
      let currentCtx: ExtendableContext<AnyInput> = ctx;

      // Выполняем цепочку middleware
      for (const middleware of this.middlewares) {
        const append = await middleware(currentCtx);

        currentCtx = {
          ...currentCtx,
          input: {
            ...currentCtx.input,
            ...append,
          },
        };
      }

      // Извлекаем payload и meta из накопленного input
      const finalInput = currentCtx.input as TInput;
      const { payload, ...meta } = finalInput as TInput & {
        payload?: unknown;
      };

      // Если цепочка не добавила payload (нет validate() в pipeline),
      // передаём handler'у сырой payload, подготовленный транспортом
      // (stream, файлы, binary и т.д.)
      const effectivePayload =
        'payload' in finalInput ? payload : ctx.raw.payload;

      // Вызываем handler с двумя параметрами: payload и meta.
      // Ключ `signal` зарезервирован: сигнал контекста перекрывает
      // одноимённое поле, добавленное middleware.
      const result = await handler(
        effectivePayload as TInput extends { payload: infer P } ? P : undefined,
        {
          ...(meta as TInput extends { payload: unknown }
            ? Omit<TInput, 'payload'>
            : TInput),
          signal: ctx.signal,
        },
      );
      return this.normalizeResponse(result);
    } catch (error) {
      return this.errorToResponse(error, options.exposeErrorDetails ?? false);
    }
  }

  /**
   * Нормализует результат handler'а в ResponseContext
   */
  private normalizeResponse<T>(result: OutputSync<T>): ResponseContext<T> {
    if (result instanceof Ok) {
      return {
        isSuccess: true,
        status: result.status,
        value: result.value,
        headers: result.headers,
      };
    }

    return {
      isSuccess: true,
      status: 'OK',
      value: result as T,
    };
  }

  /**
   * Конвертирует ошибку в ResponseContext
   *
   * `Fail` — осознанно брошенная ошибка: message/details автор раскрыл сам,
   * поэтому они попадают в тело независимо от exposeErrorDetails.
   *
   * Любая другая ошибка считается необработанной (внутренней): по умолчанию
   * (`exposeErrorDetails === false`) клиенту уходит только generic-сообщение
   * без `message` и `stack`. Раскрытие включается явно окружением.
   */
  private errorToResponse(
    error: unknown,
    exposeErrorDetails: boolean,
  ): ResponseContext<never> {
    if (error instanceof Fail) {
      const errorValue: ErrorDetails = {
        error: error.message,
      };

      if (error.details !== undefined) {
        errorValue.details = error.details;
      }

      return {
        isSuccess: false,
        status: error.status,
        value: errorValue,
      };
    }

    const errorValue: ErrorDetails = {
      error: exposeErrorDetails
        ? error instanceof Error
          ? error.message
          : 'Unknown error'
        : 'Internal server error',
    };

    if (exposeErrorDetails && error instanceof Error && error.stack) {
      errorValue.stack = error.stack;
    }

    return {
      isSuccess: false,
      status: 'INTERNAL_ERROR',
      value: errorValue,
    };
  }
}

/**
 * Создаёт пустой pipeline с пустым meta
 * Fluent API entry point
 */
export function definePipeline(): Pipeline<EmptyInput> {
  return Pipeline.empty();
}
