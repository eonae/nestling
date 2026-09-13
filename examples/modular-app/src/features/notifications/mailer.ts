import type { Letter } from './templates.js';

import type { Logger } from '@nestlingjs/app';
import { Logger$ } from '@nestlingjs/app';
import { Component, makeToken } from '@nestlingjs/container';

/** Порт отправки: всё, что фича хочет от почты */
export interface Mailer {
  send(to: string, letter: Letter): Promise<void>;
}

/**
 * DI-токен порта. Реализация приходит веткой переключателя `mail`, а тест
 * подменяет её одной строкой в `overrides`.
 */
export const Mailer$ = makeToken<Mailer>('Mailer');

/**
 * Отправка в лог: тем же интерфейсом, что у настоящего SMTP-адаптера.
 *
 * Ветка по умолчанию: пример поднимается без почтового сервера.
 */
@Component([Logger$.auto])
export class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async send(to: string, letter: Letter): Promise<void> {
    this.logger.info('mail sent', { to, subject: letter.subject });
  }
}

/**
 * Отправка через SMTP.
 *
 * Клиента здесь нет: пример показывает выбор ветки, а не протокол.
 * Адаптер отказывает всегда — так виден повтор в `welcome-email`.
 */
@Component([Logger$.auto])
export class SmtpMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async send(to: string, letter: Letter): Promise<void> {
    this.logger.warn('smtp is not configured', {
      to,
      subject: letter.subject,
    });

    throw new Error(`SMTP is not configured, cannot send to ${to}`);
  }
}
