/**
 * Семейства токенов `PortFamily` и `EmitterFamily` и типы их значений:
 * `Port`, `Emitter`, `PortMeta`, `CommandMeta`.
 *
 * Отдельный файл: на семейства ссылаются и операция (`.caller` / `.emitter`
 * — члены семейств), и модуль ядра в `@nestling/ports` (рецепты). Общий
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

import type { Token } from '@nestling/container/tokens';
import { makeTokenFamily } from '@nestling/container/tokens';

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
 * Параметры вызова команды: `PortMeta` плюс ключ идемпотентности.
 *
 * Отдельный тип, потому что ключ есть только у `command`. У `request` и
 * `event` поля нет в типе, и `{ idempotencyKey }` там — ошибка компиляции,
 * а не молча проигнорированное поле.
 */
export interface CommandMeta extends PortMeta {
  /**
   * Ключ идемпотентности команды. Если не задан, вызывающая сторона
   * генерирует свой: `emit` команды всегда отправляется с ключом.
   *
   * Ядро гарантирует только доставку ключа обработчику. Дедупликацию
   * делает satellite-пакет поверх хранилища.
   */
  idempotencyKey?: string;
}

/**
 * Тип `meta` по виду операции: `CommandMeta` для `command`, иначе
 * `PortMeta`.
 *
 * Условие проверяет поле `kind`, а не `C extends CommandOperation`:
 * операция содержит токен вызывающей стороны, тот — `InvokeArgs`, а тот
 * снова `MetaOf`. Структурная проверка операции целиком уходит в
 * бесконечную рекурсию и роняет `tsc`; проверка дискриминанта — нет.
 */
export type MetaOf<C extends AnyOperation> = C extends { kind: 'command' }
  ? CommandMeta
  : PortMeta;

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
 */
export type InvokeArgs<C extends AnyOperation> =
  undefined extends InputOf<C>
    ? [payload?: InputOf<C>, meta?: MetaOf<C>]
    : [payload: InputOf<C>, meta?: MetaOf<C>];

/**
 * Порт: вызывающая сторона операции вида `request`.
 *
 * Вызов всегда асинхронный и всегда может вернуть `Fail`, даже если
 * реализация работает в том же процессе. Поэтому код вызывающей стороны не
 * меняется, когда реализацию выносят в другой процесс.
 */
export interface Port<C extends RequestOperation<any, any, any>> {
  call(...args: InvokeArgs<C>): Promise<PortResult<C>>;
}

/**
 * Эмиттер: вызывающая сторона операций вида `command` и `event`.
 *
 * `emit` возвращает `Promise<void>`, а не `Ok | Fail`: у вызова без ответа
 * нет результата, который нужно разбирать. Promise завершается после
 * доставки сообщения, а не после его обработки.
 */
export interface Emitter<C extends EmittingOperation<any, any, any, any>> {
  emit(...args: InvokeArgs<C>): Promise<void>;
}

/**
 * Семейство портов: один член на операцию вида `request`.
 *
 * Рецепт регистрирует модуль ядра в `@nestling/ports`. `deps: [C.caller]`
 * создаёт один узел графа для этой операции; операция, которую никто не
 * вызывает, узлов не создаёт.
 *
 * @internal Пользовательский код получает токен через `Operation.caller`
 */
export const PortFamily = makeTokenFamily<Port<any>, [name: string]>('Port');

/**
 * Семейство эмиттеров: один член на операцию вида `command` или `event`
 * (см. {@link PortFamily}).
 *
 * @internal Пользовательский код получает токен через `Operation.emitter`
 */
export const EmitterFamily = makeTokenFamily<Emitter<any>, [name: string]>(
  'Emitter',
);

/** Токен порта операции: член семейства, типизированный операцией */
export type PortToken<C extends RequestOperation<any, any, any>> = Token<
  Port<C>
>;

/** Токен эмиттера операции: член семейства, типизированный операцией */
export type EmitterToken<C extends EmittingOperation<any, any, any, any>> =
  Token<Emitter<C>>;
