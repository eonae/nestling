import { AppConfig } from './app.config.js';
import { Unauthorized } from './errors.js';
import { observability } from './observability.js';

import type { Config, EmptyInput, ExtendableContext } from '@nestling/app';
import { compose, makePipeline } from '@nestling/app';
import { Handler } from '@nestling/container';

/** Тот, от чьего имени выполняется запрос */
export interface Caller {
  id: string;
}

/**
 * Pre-юнит: проверяет Bearer-токен и кладёт `caller` в контекст.
 *
 * Bearer-токен сравнивается со значением из секции конфига. Если значения
 * не совпали, юнит возвращает отказ: ни следующие юниты, ни хендлер не
 * вызываются.
 */
@Handler([AppConfig])
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
 * проверка Bearer-токена. Хендлер получает `meta.caller`.
 *
 * `Unauthorized` объявлен здесь, при подключении юнита: endpoint'ы со
 * слоем получают этот отказ в своё множество и в документ OpenAPI, не
 * перечисляя его у себя.
 */
export const authed = compose(
  observability,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);
