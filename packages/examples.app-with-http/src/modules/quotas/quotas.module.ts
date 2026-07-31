/* eslint-disable unicorn/no-useless-undefined --
 * Реализация контракта без `output` возвращает `undefined` явно: так
 * записан контракт хендлера в ядре (`Output<undefined>`). */
import { ClaimQuota, QuotaExceeded, UserRegistered } from '../../contracts';
import { appLogging } from '../../infrastructure';
import type { ILoggerService } from '../logger';
import { ILogger } from '../logger';

import { QuotaService } from './quota.service';

import { makeAppModule } from '@nestling/app';
import { Ok } from '@nestling/pipeline';
import { implement } from '@nestling/ports';

/**
 * Реализация запроса: обычная декларация на транспорте шины.
 *
 * Отличий от HTTP-ручки ровно два — конструктор и адрес; всё остальное то
 * же самое: `deps`, три формы `handle`, `resolve` в WIRE, страж границы,
 * участие в дискавери и в `policies`, вызов по значению в тестах.
 * `input`/`output`/`errors` не переобъявляются — интерфейс операции
 * принадлежит контракту.
 */
export const ClaimQuotaImpl = implement(ClaimQuota, {
  deps: [QuotaService, ILogger],
  handle:
    (quotas: QuotaService, logger: ILoggerService) =>
    async (payload: { email: string }) => {
      const claimed = quotas.claim();

      if (!claimed.ok) {
        logger.log(`quota exhausted, refusing ${payload.email}`);

        // Объявленный отказ — данные: у вызывающего он окажется настоящим
        // `Fail`, узнаваемым по `QuotaExceeded.is(...)`
        return QuotaExceeded({ limit: quotas.limit });
      }

      return new Ok({ remaining: claimed.remaining });
    },
});

/**
 * Подписчик события: `subscriber` — адрес подписки, а не декорация.
 *
 * У события 0..N подписчиков, поэтому имя обязательно: оно разводит
 * паттерны внутри процесса (`users.registered@quotas`) и станет именем
 * queue-group, когда за шиной окажется брокер.
 */
export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',
  deps: [ILogger],
  handle:
    (logger: ILoggerService) =>
    async (payload: { id: string; email: string }) => {
      logger.log(`quota bookkeeping: user ${payload.id} (${payload.email})`);

      return undefined;
    },
});

/**
 * Модуль фичи квот.
 *
 * В `providers:` — только собственный сервис; наружу фича отдаёт не токен,
 * а контракт. `endpoints:` принимает реализации контрактов наравне с
 * HTTP-ручками — новой оси регистрации не появилось.
 */
export const QuotasModule = makeAppModule({
  name: 'module:quotas',
  imports: [appLogging],
  providers: [QuotaService],
  endpoints: [ClaimQuotaImpl, UserRegisteredInQuotas],
});
