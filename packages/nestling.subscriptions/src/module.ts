/**
 * Реестр подписок — плагин, то есть параметризованная фабрика, а не новый
 * механизм.
 *
 * Роль плагина не приносит ни `forRoot`, ни `DynamicModule`, ни хуков
 * конфигурации: единица остаётся функцией, возвращающей значение. Роль
 * даёт ровно две вещи — своё поле корня (`plugins:`) и правило «к плагину
 * обращаются токенами».
 */

import { TrackSubscription, UntrackSubscription } from './layer.js';
import { SubscriptionClosed, SubscriptionOpened } from './operations.js';
import type { RegistryOptions } from './registry.js';
import { SubscriptionRegistry } from './registry.js';

import type { Plugin } from '@nestling/app';
import { makePlugin } from '@nestling/app';
import type {
  InjectionToken,
  ResourceProviderDefinition,
} from '@nestling/container';
import type { Emitter } from '@nestling/operations';

/**
 * Опции модуля — только решения композиции.
 *
 * Ничего «из среды» здесь нет: имя узла при желании привязывается конфигом
 * в корне и приходит сюда обычным значением.
 */
export interface SubscriptionsOptions extends RegistryOptions {
  /**
   * Публиковать ли факты жизненного цикла операциями.
   *
   * Выключено по умолчанию: у `event` ноль подписчиков легален, но на
   * remote-шине каждый факт — сетевая публикация, и платить ею на каждой
   * подписке должно быть решением композиции. При выключенной публикации
   * вызывателей операций в графе нет вовсе — их не запросил ни один
   * `deps`.
   */
  readonly publish?: boolean;
}

/**
 * Реестр подписок как инфраструктурный модуль.
 *
 * Значение создаётся композиционным корнем **один раз** и импортируется
 * теми, кому нужно: повторный вызов даст другое значение под тем же именем
 * и уронит сборку (идентичность модуля — значение).
 *
 * @example
 * ```typescript
 * // src/infrastructure.ts
 * export const appSubscriptions = subscriptions({
 *   identity: (ctx) => (ctx.input as { userId?: string }).userId,
 *   publish: true,
 *   node: process.env.HOSTNAME,
 * });
 * ```
 */
export const subscriptions = (options: SubscriptionsOptions = {}): Plugin => {
  // Условный список зависимостей — тот же приём, которым `portsKernel`
  // добавляет шину в `invokerDeps`: выключенная публикация не порождает
  // ни одного узла
  const deps: readonly InjectionToken[] = options.publish
    ? [SubscriptionOpened.emitter, SubscriptionClosed.emitter]
    : [];

  // Реестр — ресурс: он держит ленту, которую надо закрыть на SHUTDOWN.
  // Функциональная форма, а не класс под `@Resource`: список зависимостей
  // здесь зависит от решения композиции (`publish`), а декоратор статичен
  const registry: ResourceProviderDefinition<SubscriptionRegistry> = {
    provide: SubscriptionRegistry,
    deps,
    acquire: (
      opened?: Emitter<typeof SubscriptionOpened>,
      closed?: Emitter<typeof SubscriptionClosed>,
    ) => new SubscriptionRegistry(options, opened, closed),
    release: (value: SubscriptionRegistry) => value.release(),
  };

  return makePlugin({
    name: '@nestling/subscriptions',
    // Юниты слоя едут вместе с плагином: слой без своего реестра не
    // соберётся, и это отказ на ASSEMBLE, а не на первом запросе
    providers: [registry, TrackSubscription, UntrackSubscription],
  });
};
