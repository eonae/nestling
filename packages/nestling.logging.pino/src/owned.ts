/**
 * Опции pino, которыми держится формат записи.
 *
 * Адаптер обещает формат строки, и ключи, которые его задают, он занимает
 * за собой. Тип снимает их с поля `pino`, а `assertNotOwned` проверяет
 * ещё раз при создании логгера: `Omit` не снимает вложенный
 * `serializers.err`, а JavaScript без типов не проходит и верхних
 * проверок.
 *
 * Переданный занятый ключ — отказ с именем ключа и заменой. Молча
 * перетереть значение нельзя: это ровно то runtime magic, от которого
 * фреймворк отказывается.
 */

/** Опция pino, которую задаёт адаптер */
export type OwnedKey =
  | 'base'
  | 'errorKey'
  | 'formatters'
  | 'level'
  | 'messageKey'
  | 'timestamp'
  | 'transport';

/** Занятый ключ и то, чем его заменить */
const OWNED: Readonly<Record<OwnedKey, string>> = {
  base: 'pid and hostname are not fields of the format, add process fields with logger.child({ ... })',
  errorKey: 'the format names the error field err',
  formatters: 'the level goes into the record as a label, not as a number',
  level: 'use the level option of pinoLogger, it also accepts trace and fatal',
  messageKey: 'the format names the message field msg',
  timestamp: 'the ISO time is part of the log format',
  transport:
    'records go to stderr in the same tick, a worker thread would lose them on a crash',
};

/** Замена вложенного ключа: тип его не снимает */
const ERR_SERIALIZER =
  'serializeError from @nestlingjs/logging is part of the log format';

/**
 * Отказывает, если в опциях pino есть ключ, занятый адаптером.
 *
 * @param options - Поле `pino` опций адаптера
 * @throws TypeError - Занятый ключ передан; сообщение называет ключ и замену
 */
export function assertNotOwned(
  options: Readonly<Record<string, unknown>>,
): void {
  for (const key of Object.keys(OWNED) as OwnedKey[]) {
    if (key in options) {
      throw new TypeError(`pino.${key} is set by the adapter: ${OWNED[key]}`);
    }
  }

  const { serializers } = options;

  if (
    typeof serializers === 'object' &&
    serializers !== null &&
    'err' in serializers
  ) {
    throw new TypeError(
      `pino.serializers.err is set by the adapter: ${ERR_SERIALIZER}`,
    );
  }
}
