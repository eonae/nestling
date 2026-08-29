/**
 * Request-контекст в тесте: подставляется **подменой провайдера**, а не
 * ALS'ом.
 *
 * Ридер ambient-переменной — обычный узел графа (член семейства `Ctx`),
 * поэтому шва тут не изобретается: `contextValue` — та же пара
 * `токен → фейк`, что и любой другой элемент `overrides:`. Отсюда главное
 * свойство: сервис, читающий `Ctx(RequestId)`, тестируется прямым вызовом,
 * без `app.call` и без открытого scope'а запроса.
 */

import type { TokenString } from '@nestling/container';
import type { AnyContextVar, CtxReader } from '@nestling/pipeline';
import { Ctx } from '@nestling/pipeline';

/**
 * Подставляет фиксированное значение ambient-переменной.
 *
 * Ридер отдаёт его обоими методами: `get()` не бросает никогда, `peek()`
 * возвращает то же самое — тест сознательно объявил, что переменная здесь
 * есть, и асимметрия «полный/`Partial`» ему не предмет.
 *
 * Подмена сильнее рецепта семейства: даже если endpoint исполняется через
 * `app.call` и его пайплайн кладёт своё значение, инжектированный сервис
 * читает подставленное. Тест, которому нужно боевое поведение проекции,
 * просто не подменяет ридер.
 *
 * @param variable - Переменная (`contextVar<T>()('key')`), включая `Signal`
 * @param value - Значение, которое увидит каждый читатель этой переменной
 * @returns Элемент списка `overrides:`
 *
 * @example
 * ```typescript
 * await using app = await assembleTest({
 *   features: [UsersFeature],
 *   overrides: [contextValue(RequestId, 'req-1')],
 * });
 *
 * app.get(UsersRepository)!.currentRequestId(); // 'req-1'
 * ```
 */
export const contextValue = <T>(
  variable: AnyContextVar<T>,
  value: T,
): readonly [token: TokenString<CtxReader<T>>, value: CtxReader<T>] => [
  Ctx(variable),
  { get: () => value, peek: () => value },
];
