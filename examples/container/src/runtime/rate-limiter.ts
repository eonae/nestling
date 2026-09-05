import { Logger } from '../logging/index.js';

import { RuntimeConfig } from './runtime.config.js';

import type { Config } from '@nestling/config';
import { Injectable, OnDestroy, OnStart } from '@nestling/container';

/**
 * Потребитель reloadable-секции.
 *
 * Лимит читается из секции при каждом обращении, поэтому новое значение
 * действует без подписки. Подписка нужна только для реакции на смену:
 * здесь она пишет в лог и запоминает историю.
 */
@Injectable([RuntimeConfig, Logger.auto])
export class RateLimiter {
  /** Значения `rps`, пришедшие через `onChange` */
  readonly history: number[] = [];

  readonly #unsubscribe = new AbortController();

  constructor(
    private readonly config: Config<typeof RuntimeConfig>,
    private readonly logger: Logger,
  ) {}

  get limit(): number {
    return this.config.rps;
  }

  @OnStart()
  watch(): void {
    this.config.onChange(this.#unsubscribe.signal, (next) => {
      this.history.push(next.rps);
      this.logger.log(`rate limit changed to ${next.rps} rps`);
    });
  }

  @OnDestroy()
  stop(): void {
    this.#unsubscribe.abort();
  }
}
