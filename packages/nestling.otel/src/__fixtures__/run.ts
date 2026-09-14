/**
 * Прогон слоя участков без приложения.
 *
 * Исход вычисляет рантайм пайплайна, и он же зовёт `.finally`-шаг, поэтому
 * четыре исхода и отложенная фаза потока проверяются прямо здесь: сокета,
 * транспорта и графа для этого не нужно.
 */

import type {
  AnyInput,
  AnyOutput,
  EmptyInput,
  ExtendableContext,
  Pipeline,
  Raw,
} from '@nestlingjs/app';
import { makeEmptyContext } from '@nestlingjs/app';
import { spyLogger } from '@nestlingjs/testing';

/** Шаблон маршрута endpoint'а: имя участка берётся отсюда */
export const PATTERN = 'GET /users/:id';

/** Пайплайн с ослабленными типами — таким его видит транспорт */
type Executable = Pipeline<EmptyInput, AnyInput, never>;

/**
 * Контекст, который собрал бы транспорт.
 *
 * Адрес запроса и шаблон маршрута различаются намеренно: имя участка
 * берётся из декларации, а не из кадра.
 *
 * @param signal - Сигнал отмены запроса
 * @param output - Форма ответа из декларации; по умолчанию текст
 * @returns Начальный контекст
 */
export const contextOf = (
  signal?: AbortSignal,
  output?: AnyOutput,
): ExtendableContext<EmptyInput> => {
  const raw: Raw = {
    transport: 'test',
    pattern: 'GET /users/42',
    payload: undefined,
    attributes: {},
  };

  return makeEmptyContext(
    raw,
    { transport: 'test', pattern: PATTERN, output: output ?? 'text' },
    signal,
  );
};

/**
 * Исполняет пайплайн так, как это делает транспорт.
 *
 * @param pipeline - Слой, собранный спекой
 * @param handler - Хендлер endpoint'а
 * @param signal - Сигнал отмены запроса
 * @param output - Форма ответа из декларации
 * @returns Ответ рантайма
 */
export const run = (
  pipeline: unknown,
  handler: (payload: unknown, meta: Record<string, unknown>) => unknown,
  signal?: AbortSignal,
  output?: AnyOutput,
): Promise<unknown> =>
  (pipeline as Executable).executeWithHandler(
    handler as never,
    contextOf(signal, output) as ExtendableContext<AnyInput>,
    // Логгер заглушён шпионом: незадекларированный отказ пишется в
    // `stderr`, а предмет проверки здесь — участок, а не диагностика
    { logger: spyLogger().logger },
  );
