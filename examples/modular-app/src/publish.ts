/* eslint-disable no-console -- скрипт печатает, что положил на шину */
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

import type { Logger } from '@nestlingjs/app';
import { NatsBus } from '@nestlingjs/transport.nats';

/**
 * Логгер шины: записи о доставке уходят в консоль скрипта.
 *
 * Логгер приложения сюда не приходит: внешний отправитель ничего не знает
 * ни о контейнере, ни о его графе.
 */
const logger: Logger = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
  child: () => logger,
};

const email = process.argv[2] ?? 'carol@example.com';
const forget = process.argv.includes('--forget');

const bus = new NatsBus({
  servers: [process.env.NATS_SERVERS ?? 'nats://127.0.0.1:4222'],
  logger,
});

await bus.connect();

// Арендатор едет конвертом сообщения: в схему операции он не входит и
// доезжает до любого процесса, который её обрабатывает
const context = { tenantId: 'acme' };

if (forget) {
  await bus.publish(ForgetUser.name, { email }, { context });
  console.log(`published ${ForgetUser.name} for ${email}`);
} else {
  await bus.publish(RegisterUser.name, { name: 'Carol', email }, { context });
  console.log(`published ${RegisterUser.name} for ${email}`);
}

await bus.close();
