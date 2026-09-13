/**
 * Внешний клиент: кладёт команду на шину.
 *
 * Приложение сюда не импортируется — только определения операций и шина.
 * Так выглядит любой внешний отправитель: он знает адрес брокера и
 * операцию, а про фичи и контейнер не знает ничего.
 *
 * Запуск при поднятом приложении:
 * `yarn workspace @examples/modular-app publish:command carol@example.com`,
 * удаление — тот же вызов с `--forget`.
 */

import { ForgetUser, RegisterUser } from './operations.js';

import { makeConsoleLogger } from '@nestlingjs/app';
import { NatsBus } from '@nestlingjs/transport.nats';

/**
 * Логгер скрипта: та же фабрика, что даёт умолчание корня.
 *
 * Логгер приложения сюда не приходит: внешний отправитель ничего не знает
 * ни о контейнере, ни о его графе. Записи о доставке шина пишет в него же.
 */
const logger = makeConsoleLogger();

const email = process.argv[2] ?? 'carol@example.com';
const forget = process.argv.includes('--forget');

const bus = new NatsBus({
  servers: [process.env.NATS_SERVERS ?? 'nats://127.0.0.1:4222'],
  logger,
});

await bus.connect();

// Арендатор идёт конвертом сообщения: в схему операции он не входит и
// доходит до любого процесса, который её обрабатывает
const context = { tenantId: 'acme' };

if (forget) {
  await bus.publish(ForgetUser.name, { email }, { context });
  logger.info('published', { operation: ForgetUser.name, email });
} else {
  await bus.publish(RegisterUser.name, { name: 'Carol', email }, { context });
  logger.info('published', { operation: RegisterUser.name, email });
}

await bus.close();
