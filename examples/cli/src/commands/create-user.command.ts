import { api } from '../api.js';

import {
  EmailTaken,
  Unauthorized,
  User,
} from '@examples/microservice/operations';
import type { Output } from '@nestlingjs/app';
import { cliEndpoint } from '@nestlingjs/transport.cli';
import { z } from 'zod';

/**
 * Вход команды, часть которого собирается вопросами.
 *
 * Вопрос выводится из схемы, а не объявляется рядом с ней: `describe` даёт
 * подсказку, `boolean` — подтверждение, аннотация `meta` — умолчание.
 * Умолчание объявлено аннотацией, а не `default`: поле с `.default(…)`
 * необязательно, схема подставляет значение сама и спрашивать нечего.
 */
const CreateUserInput = z.object({
  name: z.string().min(1).describe('Имя пользователя'),
  email: z.email().describe('Адрес почты'),
  // Имя поля — имя опции: разбор `argv` берёт ключи как есть и не
  // переводит `--dry-run` в `dryRun`
  check: z.boolean().describe('Только проверить данные, не создавая'),
});

type CreateUserInput = z.infer<typeof CreateUserInput>;

/**
 * `create-user [--name …] [--email …] [--check]`: недостающее спрашивает.
 *
 * Политика `missing: 'prompt'` работает, пока ввод — терминал: в конвейере
 * и под `CI` команда доходит до валидации и отвечает отказом, как команда
 * без политики.
 */
export const CreateUser = cliEndpoint('create-user', {
  input: CreateUserInput,
  output: User,
  // Отказы те же, что объявила операция сервиса: команда их не
  // придумывает, а перечисляет
  errors: [EmailTaken, Unauthorized],
  missing: 'prompt',
  handler: async (
    input: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof Unauthorized> => {
    const created = await api.createUser({
      name: input.name,
      email: input.email,
      dryRun: input.check,
    });

    // Ответ клиента — `Ok | Fail`. Отказ сервиса уходит наружу как есть:
    // его код объявлен в той же операции, и транспорт CLI печатает его
    return created;
  },
});
