import { AppConfig } from '../app.config.js';

import type { Config, Output } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

/**
 * Версия сборки приходит секцией конфига, а не глобалью процесса.
 *
 * Ключ объявлен в `AppConfig` полем `buildVersion`, и хендлер получает
 * секцию зависимостью. Так значение видно в печати конфига и проверяется
 * схемой ещё до старта.
 */
@Handler([AppConfig])
export class BuildInfoHandler {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  async handle(): Output<{ version: string }> {
    return { version: this.config.buildVersion };
  }
}

/**
 * Версия сборки для эксплуатации.
 *
 * `detached` выводит endpoint из-под политик сборки с указанием причины.
 * `doc.hidden` убирает его из документа OpenAPI, тоже с причиной.
 */
export const BuildInfo = httpEndpoint.get('/ops/version', {
  output: z.object({ version: z.string() }),
  detached:
    'служебный endpoint эксплуатации: строка аудита на каждый опрос заслоняет полезные записи',
  doc: { hidden: 'служебный endpoint, не часть публичного API' },
  handler: BuildInfoHandler,
});
