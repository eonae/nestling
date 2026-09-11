/**
 * Секция конфигурации соединения: `DATABASE_*`.
 *
 * Семейство, а не одна секция на пакет: адрес у каждого соединения свой,
 * и основная база с аналитической не могут читать один `DATABASE_URL`.
 * Правило вставки имени задаёт ядро — то же, что у HTTP-сервера.
 *
 * Наружу отдаются только ключи: DI-токен секции остаётся приватным, и
 * инжектировать её может только этот пакет.
 */

import { DEFAULT_CONNECTION } from './naming.js';
import { flag, int, str } from './schema.js';

import type { ConfigKeys } from '@nestlingjs/app';
import { makeConfig, secret } from '@nestlingjs/app';

/**
 * Секция одного соединения.
 *
 * Соединение по умолчанию читает `DATABASE_URL`, `DATABASE_POOL_MAX` и
 * так далее; экземпляр с именем `analytics` — `DATABASE_ANALYTICS_URL`.
 *
 * Адрес помечен секретом, поэтому вычисляемый `host` наследует
 * секретность: печать секции и текст ошибки показывают маску, а лог
 * подключения пишет настоящий хост.
 *
 * @internal Инжектируется ресурсом соединения; наружу отдаётся `.keys`
 */
export const DatabaseConfig = makeConfig.family(
  'database',
  {
    /** Адрес базы целиком, вместе с пользователем и паролем */
    url: secret(str()),

    /** Сколько соединений держит пул */
    poolMax: int(10, 1),

    /** Сколько ждать свободного соединения пула */
    connectTimeoutMs: int(5000, 0),

    /** Через сколько простоя соединение закрывается */
    idleTimeoutMs: int(10_000, 0),

    /** Потолок времени одного запроса в транзакции; `0` — без потолка */
    statementTimeoutMs: int(0, 0),

    /** Подключаться ли по TLS */
    ssl: flag(false),
  },
  (derived) => ({
    /** Хост адреса: то, что можно писать в лог */
    host: derived(['url'], (url) => new URL(String(url)).host),
  }),
);

/** Проекция секции соединения */
export interface DatabaseConfigValues {
  readonly url: string;
  readonly poolMax: number;
  readonly connectTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly ssl: boolean;
  readonly host: string;
}

/**
 * Ключи секции одного соединения — для привязки источника в `config:`
 * корня. Значение плагина отдаёт их полем `keys`.
 */
export const databaseConfigKeys = (
  instance: string = DEFAULT_CONNECTION,
): ConfigKeys => DatabaseConfig(instance).keys;

/**
 * Имя ключа с адресом: его называет ошибка подключения.
 *
 * Ключи идут в порядке объявления полей, и адрес объявлен первым.
 */
export const urlKeyOf = (instance: string): string =>
  DatabaseConfig(instance).keys.names[0];
