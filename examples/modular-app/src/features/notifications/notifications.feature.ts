import { Mail } from '../../switches.js';

import { CheckAddressImpl } from './check-address.endpoint.js';
import { ForgetAddressImpl } from './forget-address.endpoint.js';
import { LogMailer, Mailer$, SmtpMailer } from './mailer.js';
import { Suppressions } from './suppressions.js';
import { WelcomeEmail } from './welcome-email.endpoint.js';

import { makeFeature } from '@nestlingjs/app';
import { classProvider } from '@nestlingjs/container';

/**
 * Фича `notifications`: владелец операций рассылки и подписчик факта
 * регистрации.
 *
 * Рассылка вынесена в свою фичу не ради примера: она медленная,
 * ретраится и масштабируется отдельно от приёма регистраций. Профиль
 * `split` поднимает её своим процессом.
 *
 * Адаптер отправки выбирает переключатель `mail`: обе ветки видны
 * статически, и в сборку попадает ровно одна.
 */
export const NotificationsFeature = makeFeature({
  name: 'notifications',
  providers: [
    Suppressions,
    Mail.pick({
      log: [classProvider(Mailer$, LogMailer)],
      smtp: [classProvider(Mailer$, SmtpMailer)],
    }),
  ],
  endpoints: [CheckAddressImpl, ForgetAddressImpl, WelcomeEmail],
});
