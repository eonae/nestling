/**
 * Два семейства вызывателей и типы их значений.
 *
 * Отдельный файл, потому что на семейства ссылаются и значение контракта
 * (`.port`/`.emitter` — члены), и kernel-модуль (рецепты): общий низ
 * разрывает цикл импортов между ними.
 */

import type {
  AnyContract,
  EmittingContract,
  FailsOf,
  InputOf,
  OutputOf,
  RequestContract,
} from './contract.js';

import type { TokenString } from '@nestling/container';
import { makeTokenFamily } from '@nestling/container';
import type {
  FailOf,
  Ok,
  UnknownError,
  ValidationFailed,
} from '@nestling/pipeline';

/**
 * Словарь вызова.
 *
 * Открыт под эксплуатационный профиль: `deadline` и `idempotencyKey`
 * приезжают отдельным change'ем и встают сюда, не меняя ни одного
 * call-site — поля добавляются, а не заменяются.
 */
export interface PortMeta {
  /**
   * Канал отмены вызова. Уезжает в контекст запроса обработчика: его
   * `meta.signal` — этот сигнал, а не сигнал чужого запроса.
   */
  signal?: AbortSignal;
}

/**
 * Отказы, которые вызов может вернуть помимо объявленных в контракте.
 *
 * То же закрытие, что у ручки: страж границы считает kernel-коды
 * контрактными для кого угодно, поэтому они входят в множество ответов
 * порта наравне с `errors:` контракта — и `default`-ветка на call-site
 * остаётся избыточной.
 */
export type KernelPortFail =
  | FailOf<typeof UnknownError>
  | FailOf<typeof ValidationFailed>;

/**
 * Множество ответов вызова: успех, объявленный отказ или kernel-отказ.
 *
 * Одинаково для co-located и remote биндинга — в этом весь смысл порта.
 */
export type PortResult<C extends AnyContract> =
  | Ok<OutputOf<C>>
  | FailsOf<C>
  | KernelPortFail;

/**
 * Аргументы вызова: контракт без формы `input` зовётся без payload'а.
 *
 * Тот же приём, что у `app.call` тестового корня: «забыл payload» —
 * ошибка компиляции, а не отказ валидации в рантайме.
 */
export type InvokeArgs<C extends AnyContract> =
  undefined extends InputOf<C>
    ? [payload?: InputOf<C>, meta?: PortMeta]
    : [payload: InputOf<C>, meta?: PortMeta];

/**
 * Вызыватель контракта вида `request`.
 *
 * Всегда async и всегда Fail-able — даже когда реализация живёт в том же
 * процессе: локальный порт, не умеющий падать, ломает потребителей в день
 * разъезда фич по процессам.
 */
export interface Port<C extends RequestContract<any, any, any>> {
  call(...args: InvokeArgs<C>): Promise<PortResult<C>>;
}

/**
 * Вызыватель контрактов видов `command` и `event`.
 *
 * `Promise<void>`, а не `Ok | Fail`: у fire-and-forget нет бизнес-результата,
 * который потребитель обязан разбирать. Promise резолвится по факту
 * **доставки**, не обработки.
 */
export interface Emitter<C extends EmittingContract<any, any, any, any>> {
  emit(...args: InvokeArgs<C>): Promise<void>;
}

/**
 * Семейство вызывателей `request`-контрактов: член на контракт.
 *
 * Рецепт регистрирует kernel-модуль портов, поэтому `deps: [C.port]`
 * материализует ровно один узел ровно для этого контракта — а контракт,
 * который никто не зовёт, не порождает узлов вовсе.
 *
 * @internal Пользовательский код обращается к вызывателю через `.port`
 */
export const PortFamily = makeTokenFamily<Port<any>, [name: string]>('Port');

/**
 * Семейство вызывателей `command`/`event`-контрактов (см. {@link PortFamily}).
 *
 * @internal Пользовательский код обращается к вызывателю через `.emitter`
 */
export const EmitterFamily = makeTokenFamily<Emitter<any>, [name: string]>(
  'Emitter',
);

/** Токен вызывателя контракта — член семейства, типизированный контрактом */
export type PortToken<C extends RequestContract<any, any, any>> = TokenString<
  Port<C>
>;

/** Токен эмиттера контракта — член семейства, типизированный контрактом */
export type EmitterToken<C extends EmittingContract<any, any, any, any>> =
  TokenString<Emitter<C>>;
