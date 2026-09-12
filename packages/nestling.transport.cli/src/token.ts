/**
 * DI-токен CLI-транспорта и его короткое имя.
 *
 * Отдельный модуль, потому что DI-токен читают обе стороны: декларация
 * (`cliEndpoint`) называет им транспорт, а транспорт берёт по нему своё
 * имя для контекста. Общий файл замкнул бы их друг на друга.
 */

import type { ITransport } from '@nestlingjs/app';
import { DEFAULT_INSTANCE, transportNameOf } from '@nestlingjs/app';
import { makeTokenFamily } from '@nestlingjs/container';

/**
 * Семейство DI-токенов CLI-транспорта: один член на экземпляр.
 *
 * Им ссылается на транспорт каждая `cliEndpoint`-декларация; `App` берёт по
 * нему инстанс из графа. Декларация выбирает экземпляр через `on:`; без
 * него это `'default'`.
 */
export const CliTransport$ = makeTokenFamily<ITransport, [instance: string]>(
  'transport:cli',
);

/** Короткое имя транспорта (`'cli'`) — то же, что читают слои пайплайна */
export const CLI_TRANSPORT_NAME = transportNameOf(
  CliTransport$(DEFAULT_INSTANCE),
);
