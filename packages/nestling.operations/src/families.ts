/**
 * Семейства DI-токенов `PortFamily` и `EmitterFamily` и типы их значений:
 * `Port`, `Emitter`, `PortMeta`, `EmitMeta`.
 *
 * Отдельный файл: на семейства ссылаются и операция (`.caller` / `.emitter`
 * — члены семейств), и модуль ядра в `@nestlingjs/app` (рецепты). Общий
 * модуль-лист разрывает цикл импортов.
 */

import type { BadRequest, InternalError, Timeout } from './kernel-fails.js';
import type { FailOf } from './make-fail.js';
import type {
  AnyOperation,
  EmittingOperation,
  InputOf,
  OperationFailsOf,
  OutputOf,
  RequestOperation,
} from './operation.js';
import type { Ok } from './result.js';

import type { Token } from '@nestlingjs/container/tokens';
import { makeTokenFamily } from '@nestlingjs/container/tokens';

/**
 * Параметры вызова порта: отмена и срок. Транспортных настроек здесь нет.
 */
export interface PortMeta {
  /**
   * Сигнал отмены вызова. Передаётся в контекст запроса обработчика как
   * его `meta.signal`.
   */
  signal?: AbortSignal;

  /**
   * Крайний срок вызова: момент времени, а не длительность. Длительность
   * устаревает на каждом `await` между её вычислением и вызовом, момент —
   * нет. Число не принимается: `500` можно прочитать и как epoch, и как
   * «через 500 мс». Для записи «через N мс» есть `deadlineIn(ms)`.
   *
   * По умолчанию не задан: вызов не ограничен по времени. Вложенный вызов
   * срок не наследует, как не наследует и `signal`.
   */
  deadline?: Date;
}

/**
 * Параметры вызова без ответа: `PortMeta` плюс ключ идемпотентности.
 *
 * Отдельный тип, потому что ключ есть у `command` и `event` — обоих видов,
 * у которых сообщение уходит без ответа. У `request` поля нет в типе, и
 * `{ idempotencyKey }` там — ошибка компиляции, а не молча
 * проигнорированное поле.
 */
export interface EmitMeta extends PortMeta {
  /**
   * Ключ идемпотентности сообщения.
   *
   * У команды ключ есть всегда: не задан вызывающим — вызыватель чеканит
   * свой. У события ключ едет тогда, и только тогда, когда его передал
   * издатель: у факта нет идентичности намерения, которую можно выдумать.
   *
   * Ядро гарантирует только доставку ключа обработчику. Дедупликацию
   * делает satellite-пакет поверх хранилища.
   */
  idempotencyKey?: string;
}

/**
 * Тип `meta` по виду операции: `PortMeta` для `request`, иначе `EmitMeta`.
 *
 * Условие проверяет поле `kind`, а не `C extends RequestOperation`:
 * операция содержит DI-токен вызывающей стороны, тот — `InvokeArgs`, а тот
 * снова `MetaOf`. Структурная проверка операции целиком уходит в
 * бесконечную рекурсию и роняет `tsc`; проверка дискриминанта — нет.
 */
export type MetaOf<C extends AnyOperation> = C extends { kind: 'request' }
  ? PortMeta
  : EmitMeta;

/**
 * Отказы ядра, которые вызов порта может вернуть помимо объявленных в
 * операции.
 *
 * Коды ядра считаются объявленными у любого endpoint'а, поэтому входят в
 * множество ответов порта наравне с `errors` операции.
 */
export type KernelPortFail =
  | FailOf<typeof InternalError>
  | FailOf<typeof BadRequest>
  | FailOf<typeof Timeout>;

/**
 * Множество ответов вызова: успех, объявленный отказ или kernel-отказ.
 *
 * Одинаково для локальной и удалённой реализации.
 */
export type PortResult<C extends AnyOperation> =
  | Ok<OutputOf<C>>
  | OperationFailsOf<C>
  | KernelPortFail;

/**
 * Аргументы вызова. У операции без `input` payload необязателен, у
 * остальных обязателен: пропущенный payload не компилируется.
 *
 * Словарь `meta` — второй тип-параметр со значением по умолчанию
 * `MetaOf<C>`: обёртка вызывающей стороны объявляет свой словарь
 * пересечением и не переписывает условие про payload.
 */
export type InvokeArgs<
  C extends AnyOperation,
  M extends MetaOf<C> = MetaOf<C>,
> = undefined extends InputOf<C>
  ? [payload?: InputOf<C>, meta?: M]
  : [payload: InputOf<C>, meta?: M];

/**
 * Порт: вызывающая сторона операции вида `request`.
 *
 * Вызов всегда асинхронный и всегда может вернуть `Fail`, даже если
 * реализация работает в том же процессе. Поэтому код вызывающей стороны не
 * меняется, когда реализацию выносят в другой процесс.
 *
 * Второй тип-параметр — словарь `meta`: точка расширения для
 * satellite-пакета. Рантайм ядра чужих полей не читает и в конверт их не
 * кладёт.
 */
export interface Port<
  C extends RequestOperation<any, any, any>,
  M extends MetaOf<C> = MetaOf<C>,
> {
  call(...args: InvokeArgs<C, M>): Promise<PortResult<C>>;
}

/**
 * Эмиттер: вызывающая сторона операций вида `command` и `event`.
 *
 * `emit` возвращает `Promise<void>`, а не `Ok | Fail`: у вызова без ответа
 * нет результата, который нужно разбирать. Promise завершается после
 * доставки сообщения, а не после его обработки.
 *
 * Второй тип-параметр — словарь `meta` (см. {@link Port}). Значение
 * расширенного типа присваивается переменной типа `Emitter<C>`, потому что
 * параметр метода в TypeScript бивариантен.
 */
export interface Emitter<
  C extends EmittingOperation<any, any, any, any>,
  M extends MetaOf<C> = MetaOf<C>,
> {
  emit(...args: InvokeArgs<C, M>): Promise<void>;
}

/**
 * Семейство портов: один член на операцию вида `request`.
 *
 * Рецепт регистрирует модуль ядра в `@nestlingjs/app`. `deps: [C.caller]`
 * создаёт один узел графа для этой операции; операция, которую никто не
 * вызывает, узлов не создаёт.
 *
 * @internal Пользовательский код получает DI-токен через `Operation.caller`
 */
export const PortFamily = makeTokenFamily<Port<any>, [name: string]>('Port');

/**
 * Семейство эмиттеров: один член на операцию вида `command` или `event`
 * (см. {@link PortFamily}).
 *
 * @internal Пользовательский код получает DI-токен через `Operation.emitter`
 */
export const EmitterFamily = makeTokenFamily<Emitter<any>, [name: string]>(
  'Emitter',
);

/** DI-токен порта операции: член семейства, типизированный операцией */
export type PortToken<C extends RequestOperation<any, any, any>> = Token<
  Port<C>
>;

/** DI-токен эмиттера операции: член семейства, типизированный операцией */
export type EmitterToken<C extends EmittingOperation<any, any, any, any>> =
  Token<Emitter<C>>;
