import { AppConfig } from '../../app.config';
import { Unauthorized } from '../../errors';

import type { Config } from '@nestling/config';
import { Injectable } from '@nestling/container';
import type { EmptyInput, ExtendableContext } from '@nestling/pipeline';

/** Тот, от чьего имени выполняется запрос */
export interface Caller {
  id: string;
}

/**
 * Pre-юнит: проверяет bearer-токен и кладёт `caller` в контекст.
 *
 * Токен сравнивается со значением из секции конфига. Неверный токен
 * бросает отказ, и хендлер не вызывается.
 */
@Injectable([AppConfig])
export class Authenticate {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  handle(ctx: ExtendableContext<EmptyInput>): { caller: Caller } {
    const header = ctx.raw.attributes.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : undefined;

    if (token === undefined || token !== this.config.apiToken) {
      throw Unauthorized();
    }

    return { caller: { id: 'api-token' } };
  }
}
