/**
 * Операции, через которые общаются фичи `users` и `notifications`.
 *
 * Файл лежит вне фич: операция не принадлежит ни вызывающему, ни
 * реализующему. Обе фичи импортируют только его и не знают DI-токенов
 * друг друга, поэтому решение «один процесс или два» принимает корень, а
 * не код фич.
 */

import {
  makeCommand,
  makeEvent,
  makeFail,
  makeRequest,
} from '@nestlingjs/operations';
import { z } from 'zod';

/** Отказ владельца рассылки: на этот адрес письма не уходят */
export const AddressRejected = makeFail('conflict:address_rejected', {
  details: z.object({ email: z.string(), reason: z.string() }),
  message: (d) => `Address ${d.email} is not deliverable: ${d.reason}`,
});

export const RegisterUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),
});

export type RegisterUserInput = z.infer<typeof RegisterUserInput>;

/**
 * Команда регистрации: вход процесса `users`.
 *
 * Внешний клиент кладёт её на шину. Команда, а не запрос: у регистрации
 * ровно один владелец, а ответа клиент не ждёт.
 */
export const RegisterUser = makeCommand({
  name: 'users.register',
  input: RegisterUserInput,
});

export const ForgetUserInput = z.object({ email: z.email() });

export type ForgetUserInput = z.infer<typeof ForgetUserInput>;

/** Команда удаления: вход того же процесса */
export const ForgetUser = makeCommand({
  name: 'users.forget',
  input: ForgetUserInput,
});

export const CheckAddressInput = z.object({ email: z.string() });
export const CheckAddressOutput = z.object({ deliverable: z.boolean() });

export type CheckAddressInput = z.infer<typeof CheckAddressInput>;
export type CheckAddressOutput = z.infer<typeof CheckAddressOutput>;

/**
 * Запрос к владельцу рассылки: дойдёт ли письмо на этот адрес.
 *
 * У запроса ровно один владелец, и вызывающий ждёт ответа. Если владелец
 * не выбран в этой сборке, вызов уходит через брокер в другой процесс.
 * Список отказных адресов ведёт тот, кто шлёт письма, — поэтому знание
 * живёт в `notifications`, а не в `users`.
 */
export const CheckAddress = makeRequest({
  name: 'notifications.check-address',
  input: CheckAddressInput,
  output: CheckAddressOutput,
  errors: [AddressRejected],
});

export const UserRegisteredInput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export type UserRegisteredInput = z.infer<typeof UserRegisteredInput>;

/**
 * Факт регистрации пользователя.
 *
 * Событие, а не команда: подписчиков у факта ноль или больше, и ни один
 * из них не отвечает создателю. `durable: true` объявляет доставку,
 * которая переживает перезапуск подписчика: брокер заводит под событием
 * поток JetStream, издатель ждёт подтверждения записи, подписчик читает
 * из потока.
 */
export const UserRegistered = makeEvent({
  name: 'users.registered',
  durable: true,
  input: UserRegisteredInput,
  doc: {
    summary: 'Пользователь зарегистрирован',
    description: 'Публикуется после коммита транзакции, которая его создала.',
    tags: ['users'],
  },
});

export const ForgetAddressInput = z.object({ email: z.string() });

export type ForgetAddressInput = z.infer<typeof ForgetAddressInput>;

/**
 * Команда «убери адрес из рассылок».
 *
 * Вид `command`: владелец ровно один, и повторную доставку нужно
 * отличать от новой. Для этого у `meta` команды есть `idempotencyKey`; у
 * события и запроса его нет. Ядро ключ не проверяет, а только доставляет
 * до обработчика.
 */
export const ForgetAddress = makeCommand({
  name: 'notifications.forget-address',
  input: ForgetAddressInput,
});
