/**
 * Интерфейсы хендлера: `HandlerMeta` и `Handler<C>`.
 *
 * Оба живут здесь, а не в `@nestlingjs/operations`: интерфейсу нужны и
 * операция, и типы пайплайна. Имя `Handler` носят интерфейс и декоратор
 * роли — декоратор реэкспортируется из `@nestlingjs/container` тем же
 * именем, поэтому класс-хендлер объявляется одним импортом.
 */

import { Handler as HandlerDecorator } from '@nestlingjs/container';
import type {
  AnyOperation,
  InputOf,
  OperationFailsOf,
  Output,
  OutputOf,
} from '@nestlingjs/operations';

/**
 * Второй параметр хендлера: сигнал отмены и поля контекста.
 *
 * Поля накапливают `.pre`-юниты пайплайна, поэтому их состав известен
 * декларации, а не хендлеру: конкретный тип подставляет слот `handler:`.
 * Ключ `signal` зарезервирован — значение пайплайна перекрывает
 * одноимённое поле юнита.
 */
export interface HandlerMeta {
  /** Сигнал отмены запроса: дисконнект клиента или остановка транспорта */
  readonly signal: AbortSignal;

  /** Поля контекста, накопленные `.pre`-юнитами */
  readonly [field: string]: unknown;
}

/**
 * Интерфейс хендлера операции.
 *
 * Типы входа, результата и множества отказов берутся с операции и руками
 * не переписываются. `implements Handler<typeof Op>` даёт автодополнение
 * и раннюю ошибку в самом классе; окончательная сверка со схемами
 * остаётся в слоте `handler:` декларации, потому что у
 * `httpEndpoint` операции нет.
 *
 * HTTP-специфики здесь нет: класс с этим интерфейсом переносим между
 * транспортами. Хендлеру, которому нужен запрос или ответ HTTP, служит
 * `HttpHandler<C>` из `@nestlingjs/transport.http`.
 *
 * @param C - Тип операции (`typeof CreateOrder`)
 *
 * @example
 * ```typescript
 * @Handler([OrdersService])
 * export class CreateOrderHandler implements Handler<typeof CreateOrder> {
 *   constructor(private orders: OrdersService) {}
 *   async handle(input: NewOrder, meta: HandlerMeta) { … }
 * }
 * ```
 */
export interface Handler<C extends AnyOperation> {
  handle(
    input: InputOf<C>,
    meta: HandlerMeta,
  ): Output<OutputOf<C>, OperationFailsOf<C>>;
}

/**
 * Декоратор роли `@Handler([deps])`.
 *
 * Значение то же, что в `@nestlingjs/container`: реэкспорт объединяет
 * декоратор с одноимённым интерфейсом, и класс-хендлер операции берёт обе
 * формы одним импортом. Код без операций импортирует декоратор из
 * `@nestlingjs/container`.
 */
export const Handler = HandlerDecorator;
