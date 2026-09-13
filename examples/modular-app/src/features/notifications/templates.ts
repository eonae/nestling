/**
 * Шаблоны писем: текст отделён от того, кто его шлёт.
 *
 * Шаблон — чистая функция: письмо собирается без DI-токенов, без базы и
 * без сети, поэтому его проверяет обычный юнит-тест.
 */

/** Письмо: тема и тело */
export interface Letter {
  subject: string;
  body: string;
}

/** Приветственное письмо о регистрации */
export const welcome = (user: { name: string }): Letter => ({
  subject: 'Welcome aboard',
  body:
    `Hi ${user.name},\n\n` +
    'your account is ready. Reply to this letter if you need a hand.\n',
});
