import type { RegisterUserInput } from '../../operations.js';
import {
  CheckAddress,
  RegisterUser,
  UserRegistered,
} from '../../operations.js';
import { transactional } from '../../persistence.js';

import { UsersMetrics } from './users.metrics.js';
import type { UsersRepository } from './users.repository.js';
import { UsersRepository$ } from './users.repository.js';

import type { Logger, MetricsOf, Port } from '@nestlingjs/app';
import { deadlineIn, implement, Logger$ } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import type { OutboxEmitter } from '@nestlingjs/outbox';
import { outboxed } from '@nestlingjs/outbox';

/**
 * Бюджет вызова соседней фичи, в миллисекундах.
 *
 * У вызова через порт нет умолчания: неявный таймаут однажды оборвал бы
 * долгую, но корректную операцию. Бюджет задаёт вызывающий.
 */
const CHECK_BUDGET_MS = 500;

/**
 * `outboxed(UserRegistered)` вместо `UserRegistered.emitter` — одна
 * строка в списке зависимостей. Значение присваивается `Emitter<C>`, а
 * его словарь `meta` дополнен разделом записи. Меняется момент доставки:
 * запись уходит в шину после коммита, а не во время запроса.
 */
@Handler([
  UsersRepository$,
  CheckAddress.caller,
  outboxed(UserRegistered),
  Logger$.auto,
  UsersMetrics,
])
export class RegisterUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly addresses: Port<typeof CheckAddress>,
    private readonly registered: OutboxEmitter<typeof UserRegistered>,
    private readonly logger: Logger,
    // Группа метрик — такой же DI-токен, как порт и логгер: метрика
    // выбирается полем писателя, а не называется строкой
    private readonly metrics: MetricsOf<typeof UsersMetrics>,
  ) {}

  async handle(payload: RegisterUserInput): Promise<void> {
    // Идентификатор трассы в запись кладёт логгер ядра: он читает его из
    // контекста сам, и руками поле не пишется
    this.logger.info('register');

    if (await this.users.byEmail(payload.email)) {
      this.logger.info('already registered', { email: payload.email });
      this.metrics.registrations.add({ outcome: 'duplicate' });

      return;
    }

    // Соседняя фича вызывается через порт: вызов асинхронный и возвращает
    // `Ok | Fail` даже в одном процессе. Отказ разбирает вызывающий.
    // `deadline` — момент, а не длительность: он не сдвигается на `await`
    const checked = await this.addresses.call(
      { email: payload.email },
      { deadline: deadlineIn(CHECK_BUDGET_MS) },
    );

    if (checked.isFail) {
      // Отказ соседа объявлен в `errors:` операции и приходит `Fail` того
      // же определения и из соседнего процесса, и из этого
      this.logger.info('address rejected', { code: checked.code });
      this.metrics.registrations.add({ outcome: 'address_rejected' });

      return;
    }

    const user = await this.users.insert(payload);

    // Запись пользователя и запись события — одна транзакция. Упади
    // процесс сразу после коммита, событие всё равно уйдёт. Раздел —
    // идентификатор пользователя: его события доставляются по порядку
    await this.registered.emit(user, { partitionKey: user.id });

    this.metrics.registrations.add({ outcome: 'registered' });
  }
}

/**
 * Реализация команды `users.register`: декларация endpoint'а на
 * транспорте шины.
 *
 * `input` принадлежит операции и здесь не повторяется. Всё остальное как
 * у HTTP-endpoint'а: класс-хендлер, участие в discovery и политиках,
 * вызов по значению в тестах.
 */
export const RegisterUserImpl = implement(RegisterUser, {
  pipeline: transactional,
  handler: RegisterUserHandler,
});
