import { RuntimeConfig } from './runtime.config.js';

import type { Config, Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Component, OnStart } from '@nestling/container';

/**
 * Потребитель reloadable-секции.
 *
 * Лимит читается из секции при каждом обращении, поэтому новое значение
 * действует без подписки. Подписка нужна только для реакции на смену:
 * здесь она пишет в лог и запоминает историю.
 */
@Component([RuntimeConfig, Logger$.auto])
export class RateLimiter {
  /** Значения `rps`, пришедшие через `onChange` */
  readonly history: number[] = [];

  constructor(
    private readonly config: Config<typeof RuntimeConfig>,
    private readonly logger: Logger,
  ) {}

  get limit(): number {
    return this.config.rps;
  }

  /**
   * Открывает подписку на смену секции.
   *
   * Сигнал — канал остановки приложения, тот же, что получают транспорты:
   * подписка снимается им, отдельный `AbortController` не нужен.
   */
  @OnStart()
  watch(signal: AbortSignal): void {
    this.config.onChange(signal, (next) => {
      this.history.push(next.rps);
      this.logger.info('rate limit changed', { rps: next.rps });
    });
  }
}
