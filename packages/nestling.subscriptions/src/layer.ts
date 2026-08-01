/**
 * Слой `tracked` — два юнита и ничего больше.
 *
 * Оба юнита — класс-формы: функциональная форма зависимостей не имеет, а
 * реестр это singleton графа. Класс резолвится контейнером на WIRE, поэтому
 * ручка со слоем, но без модуля `subscriptions({ … })` отказывает на
 * ASSEMBLE, а не на первом запросе.
 */

import type { SubscriptionContext } from './registry.js';
import { SubscriptionRegistry } from './registry.js';
import type { TrackedSubscription } from './types.js';

import { Injectable } from '@nestling/container';
import type { Outcome, ResponseContext } from '@nestling/pipeline';
import { makePipeline } from '@nestling/pipeline';

/**
 * Регистрация подписки перед вызовом хендлера.
 *
 * Добавка типизирована, поэтому хендлер видит `meta.subscription` в типах —
 * а не узнаёт о нём из документации.
 */
@Injectable([SubscriptionRegistry])
export class TrackSubscription {
  constructor(private readonly registry: SubscriptionRegistry) {}

  handle(ctx: SubscriptionContext): { subscription: TrackedSubscription } {
    return { subscription: this.registry.open(ctx) };
  }
}

/**
 * Снятие подписки на выходе.
 *
 * `.finally` вызывается всегда и последним; для потоковой формы `output` —
 * после того, как поток дотёк, оборвался или был закрыт потребителем.
 * Поэтому запись живёт ровно столько, сколько живёт сама подписка.
 */
@Injectable([SubscriptionRegistry])
export class UntrackSubscription {
  constructor(private readonly registry: SubscriptionRegistry) {}

  handle(
    outcome: Outcome,
    _res: ResponseContext,
    // Собственные поля слоя на ответном тракте — `Partial`: регистрация
    // могла не случиться (внешний pre упал раньше). Тогда снимать нечего
    ctx: { input: { subscription?: TrackedSubscription } },
  ): void {
    const id = ctx.input.subscription?.id;

    if (id !== undefined) {
      this.registry.close(id, outcome);
    }
  }
}

/**
 * Слой трекинга подписок — значение, композируемое на ручку.
 *
 * ```typescript
 * pipeline: compose(basePipeline, tracked)
 * ```
 *
 * Ambient-подключения нет: слой ставится явно, а вездесущность, если она
 * приложению нужна, выражается политикой сборки
 * `everyEndpoint({ … }).hasLayer(tracked)` — идентичность слоя ссылочная,
 * поэтому политика адресует именно это значение.
 */
export const tracked = makePipeline()
  .pre(TrackSubscription)
  .finally(UntrackSubscription);
