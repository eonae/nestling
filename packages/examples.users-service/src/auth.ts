import { AppConfig } from './app.config.js';
import { Unauthorized } from './errors.js';
import { observability } from './observability.js';

import type { Config } from '@nestling/config';
import { Injectable } from '@nestling/container';
import type { EmptyInput, ExtendableContext } from '@nestling/pipeline';
import { compose, makePipeline } from '@nestling/pipeline';

/** Тот, от чьего имени выполняется запрос */
export interface Caller {
  id: string;
}

/**
 * Pre-юнит: проверяет bearer-токен и кладёт `caller` в контекст.
 *
 * Токен сравнивается со значением из секции конфига. При неверном токене
 * юнит возвращает отказ, и ни следующие юниты, ни хендлер не вызываются.
 */
@Injectable([AppConfig])
export class Authenticate {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  handle(
    ctx: ExtendableContext<EmptyInput>,
  ): { caller: Caller } | ReturnType<typeof Unauthorized> {
    const header = ctx.raw.attributes.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : undefined;

    if (token === undefined || token !== this.config.apiToken) {
      return Unauthorized();
    }

    return { caller: { id: 'api-token' } };
  }
}

/**
 * Слой для endpoint'ов, которые меняют данные: наблюдаемость плюс
 * проверка токена. Хендлер получает `meta.caller`.
 *
 * `Unauthorized` объявлен здесь, при подключении юнита: endpoint'ы со
 * слоем получают этот отказ в своё множество и в документ OpenAPI, не
 * перечисляя его у себя.
 */
export const authed = compose(
  observability,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);
