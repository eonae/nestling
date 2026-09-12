import { observability } from '../../../plugins/observability/index.js';
import { User } from '../user.js';
import { UserNotFound } from '../users.errors.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import { Handler } from '@nestlingjs/container';
import type { HttpHandlerMeta, HttpOutput } from '@nestlingjs/transport.http';
import { httpEndpoint, HttpResponse } from '@nestlingjs/transport.http';

/** Вход по email: пароля у примера нет, важна форма ответа */
const Credentials = User.pick({ email: true });

/** Время жизни cookie сессии, в секундах */
const SESSION_TTL = 3600;

/**
 * HTTP-форма хендлера: `meta` с запросом и результат с `HttpResponse`.
 *
 * Такой класс живёт только в декларации со своим адресом: его объявил
 * транспорт, поэтому HTTP-специфика здесь допустима. В `implement` и в
 * `httpEndpoint.implement` он не проходит по типам, и невозможность
 * переиспользовать его на шине видна при компиляции.
 */
@Handler([UsersRepository$])
export class LoginHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(
    input: { email: string },
    meta: HttpHandlerMeta,
  ): HttpOutput<never, typeof UserNotFound> {
    const user = await this.users.byEmail(input.email);
    if (!user) {
      return UserNotFound({ id: input.email });
    }

    // Заголовок запроса читается из `meta.http`: отдельного API для
    // cookie и заголовков в V1 нет
    const secure = meta.http.headers['x-forwarded-proto'] === 'https';

    return HttpResponse.redirect('/app', {
      cookies: [
        {
          name: 'sid',
          value: user.id,
          path: '/',
          maxAge: SESSION_TTL,
          httpOnly: true,
          sameSite: 'lax',
          secure,
        },
      ],
    });
  }
}

/**
 * Редирект объявлен декларацией: по полю `redirect` документ OpenAPI
 * показывает ответ 303 с заголовком `Location`, а транспорт берёт этот
 * статус, если вызов `HttpResponse.redirect` свой не задал. Без поля
 * ответ был бы `internal_error`.
 */
export const Login = httpEndpoint({
  method: 'POST',
  path: '/login',
  input: Credentials,
  redirect: 303,
  errors: [UserNotFound],
  detached: 'вход выдаёт сессию, поэтому Bearer-токена у него ещё нет',
  doc: { summary: 'Вход по email', tags: ['users'] },
  pipeline: observability,
  handler: LoginHandler,
});
