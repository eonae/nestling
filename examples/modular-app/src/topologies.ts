/**
 * Варианты деплоя приложения и конфиг проверки состава.
 *
 * Список один на все проверки: его читают сверка совместимости, спека
 * снимка и спека изоляции. Топология описывается аргументом сборки
 * целиком — тем же значением, которое принимает `app.build(args)`.
 */

import type { CheckOptions } from '@nestlingjs/app';
import { bind } from '@nestlingjs/app';
import { zodConverter } from '@nestlingjs/schema.zod';
import { vars } from '@nestlingjs/testing';

/** `all` — один процесс, остальные — по процессу на фичу */
export const TOPOLOGIES = ['all', 'users', 'notifications'] as const;

/**
 * Опции `check()`: конвертер схем и конфиг проверки.
 *
 * `check()` строит граф, но не открывает ни базы, ни брокера, поэтому
 * адрес здесь любой непустой: секция обязана прочитаться, соединение по
 * ней не устанавливается. Список заменяет `defaultSources` целиком —
 * проверка обходится без источников и без `process.env`.
 */
export const CHECK_OPTIONS: CheckOptions = {
  converters: [zodConverter()],
  config: [
    bind(
      vars({ DATABASE_URL: 'postgresql://check:check@localhost:5432/check' }),
    ),
  ],
};
