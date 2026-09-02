/**
 * Чтение контекстных переменных через DI: ридер переменной — член
 * семейства токенов, то есть обычный узел графа.
 *
 * Поэтому зависимость от контекста запроса видна в визуализации и
 * `explain()`, полный список чтений известен на `build()`, а тест
 * подменяет ридер обычным `valueProvider` без `AsyncLocalStorage`.
 */

import { currentCell } from './store.js';
import type { AnyContextVar } from './variable.js';
import { isContextVar, SIGNAL_KEY } from './variable.js';

import type { Token } from '@nestling/container';
import { makeTokenFamily } from '@nestling/container';

/**
 * Ридер контекстной переменной: два метода чтения, записи нет.
 *
 * Два метода отражают состояния контекста: до хендлера он полон, в
 * `.catch`/`.finally` — `Partial`, а вне запроса его нет.
 */
export interface CtxReader<T> {
  /**
   * Значение переменной.
   *
   * @throws {ContextVarUnavailableError} Если переменной в контексте нет;
   * текст называет причину и способ починки
   */
  get(): T;

  /** Значение переменной или `undefined`, если её в контексте нет */
  peek(): T | undefined;
}

/** Ридер любой переменной: тип члена семейства */
export type AnyCtxReader = CtxReader<unknown>;

/**
 * Семейство ридеров. Не экспортируется: наружу отдаётся типизированная
 * функция {@link Ctx}, поэтому `Ctx('опечатка')` не компилируется, а тип
 * члена выводится из переменной.
 *
 * @internal Рецепт семейства регистрирует модуль ядра `contextKernel()`
 */
export const CtxFamily = makeTokenFamily<AnyCtxReader, [key: string]>('Ctx');

/**
 * Возвращает токен ридера переменной. Это обычный токен: он годится в
 * `deps` класса с `@Injectable`, фабричного провайдера, декларации
 * endpoint'а и в `container.get()`.
 *
 * @param variable - Значение переменной (`contextVar<T>()('key')`)
 * @returns Токен члена семейства с типом `CtxReader<T>`
 *
 * @example
 * ```typescript
 * @Injectable([Ctx(RequestId), ILogger])
 * export class UsersRepository {
 *   constructor(
 *     private readonly requestId: CtxReader<string>,
 *     private readonly logger: ILoggerService,
 *   ) {}
 * }
 * ```
 */
export const Ctx = <T>(
  variable: AnyContextVar<T>,
): Token<CtxReader<T>> => {
  if (!isContextVar(variable)) {
    throw new TypeError(
      `Ctx(variable) expects a context variable value, not a key: declare it ` +
        `with contextVar<T>()('key') and pass the value.`,
    );
  }

  return CtxFamily(variable.key) as unknown as Token<CtxReader<T>>;
};

/**
 * Ошибка `get()`: переменной нет в контексте. Это ошибка программы, а не
 * отказ домена: пайплайн обрабатывает её как любую необработанную ошибку,
 * и клиент деталей не видит.
 */
export class ContextVarUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextVarUnavailableError';
  }
}

/** Собирает ошибку `get()`; текст зависит от фазы запроса */
function unavailable(key: string, phase?: string): ContextVarUnavailableError {
  if (phase === undefined) {
    return new ContextVarUnavailableError(
      `Context variable '${key}' is unavailable: there is no request context ` +
        `here (@OnInit, @OnStart, cron or a background task run outside a ` +
        `request). Use peek() if the code legitimately runs on both paths.`,
    );
  }

  if (phase === 'response' || phase === 'finally' || phase === 'stream') {
    return new ContextVarUnavailableError(
      `Context variable '${key}' is unavailable on the response track: the ` +
        `pre-track did not reach the unit that provides it, so the projection ` +
        `is Partial here. Use peek() — response, finally and stream units see ` +
        `an incomplete input by design.`,
    );
  }

  return new ContextVarUnavailableError(
    `Context variable '${key}' is not in the accumulated input: compose a ` +
      `layer with <Var>.provide(…) into the pipeline of this endpoint, and ` +
      `declare the invariant with everyEndpoint(…).hasVar(<Var>) so the build ` +
      `fails instead of the request.`,
  );
}

/**
 * Создаёт ридер ключа. Состояния у ридера нет: всё хранится в ячейке
 * запроса, поэтому один инстанс обслуживает любое число одновременных
 * запросов.
 *
 * @internal Вызывается рецептом семейства в `contextKernel()`
 */
export const makeCtxReader = (key: string): AnyCtxReader => ({
  peek: () => {
    const cell = currentCell();

    if (!cell) {
      return;
    }

    // Сигнал хранится не в `input`, а в самой ячейке
    if (key === SIGNAL_KEY) {
      return cell.signal;
    }

    // Проверка по ключу, а не по значению: поле со значением `undefined`
    // считается положенным
    return key in cell.input ? cell.input[key] : undefined;
  },

  get: () => {
    const cell = currentCell();

    if (!cell) {
      throw unavailable(key);
    }

    if (key === SIGNAL_KEY) {
      return cell.signal;
    }

    if (!(key in cell.input)) {
      throw unavailable(key, cell.phase);
    }

    return cell.input[key];
  },
});
