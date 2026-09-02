/**
 * Модель подписки: значения, которыми реестр разговаривает наружу.
 *
 * Всё здесь — плоские значения без ссылок на рантайм: снимок подписки
 * передаётся и в ответ административного endpoint'а, и в факт операции,
 * поэтому второй формы (живой объект, `Date` вместо epoch ms) не
 * заводится.
 */

import { describeForm, isStreamKind } from '@nestling/contracts';
import type { EndpointMeta, Outcome } from '@nestling/pipeline';

/**
 * Форма ответа отслеживаемого endpoint'а.
 *
 * Различать `stream` и `events` администратору нужно (конечный экспорт и
 * открытая подписка живут по-разному), а `multipart` и «просто значение»
 * для реестра одно и то же — обе не текут.
 */
export type SubscriptionKind = 'value' | 'stream' | 'events';

/**
 * Снимок подписки — замороженное значение, собранное на момент чтения.
 *
 * Живой объект наружу не передаётся: `ctx` и административный контроллер
 * остаются во внутренней записи реестра.
 */
export interface SubscriptionInfo {
  /** Идентичность подписки в пределах процесса */
  readonly id: string;

  /** Транспорт endpoint'а (`http`, `cli`, `bus`, …) */
  readonly transport: string;

  /** Паттерн endpoint'а — то же значение, что видит discovery */
  readonly pattern: string;

  /** Форма `output` endpoint'а */
  readonly kind: SubscriptionKind;

  /** Кто подписан — вычисляется экстрактором опций модуля */
  readonly identity?: string;

  /** Произвольные метки подписки — тот же источник, что у `identity` */
  readonly labels: Readonly<Record<string, string>>;

  /** Момент открытия, epoch ms: то же значение передаётся в факт операции */
  readonly startedAt: number;

  /** Отдано элементов на момент снятия снимка (`ctx.summary.itemsOut`) */
  readonly itemsOut: number;
}

/**
 * Фильтр списка и массового завершения.
 *
 * Совпадение точное; `labels` — по подмножеству: подписка подходит, если
 * несёт **все** перечисленные метки с теми же значениями.
 */
export interface SubscriptionFilter {
  readonly transport?: string;
  readonly pattern?: string;
  readonly identity?: string;
  readonly labels?: Readonly<Record<string, string>>;
}

/**
 * Причина закрытия подписки — словарь ядра плюс ровно одно слово.
 *
 * `killed` нужен потому, что пайплайн административное завершение выразить
 * не может и не должен: `computeOutcome` смотрит на сигнал **запроса**, а
 * сигнал реестра — другой, и источник, закончившийся из-за него, честно
 * даёт `completed`. Ядро описывает исход запроса, реестр — судьбу подписки.
 */
export type CloseReason = Outcome | 'killed';

/** Событие ленты реестра: размеченное объединение */
export type SubscriptionEvent =
  | { readonly type: 'opened'; readonly info: SubscriptionInfo }
  | {
      readonly type: 'closed';
      readonly info: SubscriptionInfo;
      readonly reason: CloseReason;
    };

/**
 * То, что слой кладёт хендлеру в `meta.subscription`.
 *
 * `signal` — комбинация сигнала запроса и административного контроллера
 * записи: одна подписка на него закрывает все три причины отмены
 * (дисконнект, shutdown, административный kill). Ключ `signal` в `meta`
 * зарезервирован пайплайном, поэтому канал именно **второй**.
 */
export interface TrackedSubscription {
  readonly id: string;
  readonly signal: AbortSignal;
}

/**
 * Форма `output` endpoint'а как `kind` снимка.
 *
 * Не-потоковая форма (`value`, `multipart`) даёт `'value'`: реестр
 * различает только то, что различимо в его собственных терминах.
 */
export function kindOfOutput(endpoint: EndpointMeta): SubscriptionKind {
  const { kind } = describeForm(endpoint.output);

  return isStreamKind(kind) ? kind : 'value';
}
