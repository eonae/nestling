/**
 * Ридер ambient-переменной — **член token family**, то есть обычный узел
 * DI-графа.
 *
 * Отсюда всё остальное: зависимость от request-контекста видна в
 * визуализации и `explain()`, полный список ambient-чтений приложения
 * известен на `build()` (члены материализуются фикспоинтом по `deps`, а не
 * резолвятся в рантайме), а тест подменяет ридер обычным `valueProvider` —
 * ALS для теста сервиса не нужен.
 */

import { currentCell } from './store.js';
import type { AnyContextVar } from './variable.js';
import { isContextVar, SIGNAL_KEY } from './variable.js';

import type { TokenString } from '@nestling/container';
import { makeTokenFamily } from '@nestling/container';

/**
 * Чтение ambient-переменной: ровно два метода и ни одного сеттера.
 *
 * Пара — зеркало асимметрии пайплайна: на успешном тракте контекст полон,
 * на ответном он `Partial`, а вне запроса его нет вовсе.
 */
export interface CtxReader<T> {
  /**
   * Значение переменной.
   *
   * @throws {ContextVarUnavailableError} Если переменной в текущей проекции
   * нет; текст называет причину и починку
   */
  get(): T;

  /** Значение переменной или `undefined`, если её в проекции нет */
  peek(): T | undefined;
}

/** Ридер любой переменной: тип члена семейства */
export type AnyCtxReader = CtxReader<unknown>;

/**
 * Семейство ридеров. **Приватное**: наружу отдаётся типизированный аксессор
 * {@link Ctx}, поэтому `Ctx('опечатка')` строкой не компилируется, а тип
 * члена выводится из переменной, а не из семейства.
 *
 * @internal рецепт регистрирует kernel-модуль `contextKernel()`
 */
export const CtxFamily = makeTokenFamily<AnyCtxReader, [key: string]>('Ctx');

/**
 * Токен ридера переменной — обычный токен: годится в `deps`
 * `@Injectable`-класса, фабричного провайдера, декларации ручки и в
 * `container.get()`.
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
): TokenString<CtxReader<T>> => {
  if (!isContextVar(variable)) {
    throw new TypeError(
      `Ctx(variable) expects a context variable value, not a key: declare it ` +
        `with contextVar<T>()('key') and pass the value.`,
    );
  }

  return CtxFamily(variable.key) as unknown as TokenString<CtxReader<T>>;
};

/**
 * Недоступность ambient-переменной — **программная** ошибка, а не доменный
 * отказ: страж границы нормализует её как любую необработанную, и клиенту
 * знать о ней нечего.
 */
export class ContextVarUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextVarUnavailableError';
  }
}

/** Диагностика `get()`: текст зависит от того, что рантайм знает о месте вызова */
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
 * Рецепт члена: stateless-ридер ключа.
 *
 * Состояния у ридера нет — вся динамика в ячейке запроса, поэтому один
 * инстанс на приложение обслуживает любое число одновременных запросов.
 *
 * @internal вызывается рецептом семейства в `contextKernel()`
 */
export const makeCtxReader = (key: string): AnyCtxReader => ({
  peek: () => {
    const cell = currentCell();

    if (!cell) {
      return;
    }

    // Сигнал живёт не в `input`: его присутствие определяется наличием
    // самого scope'а
    if (key === SIGNAL_KEY) {
      return cell.signal;
    }

    // Присутствие — по ключу, а не по значению: поле, положенное со
    // значением `undefined`, положено
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
