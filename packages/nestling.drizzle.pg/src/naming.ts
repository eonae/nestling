/**
 * Имена, выведенные из имени экземпляра соединения.
 *
 * Правило детерминированное и одно на весь пакет: соединение по
 * умолчанию берёт короткие имена (`tx`, `database`), именованное —
 * имена с приставкой. Поэтому два соединения не спорят ни за поле
 * контекста, ни за идентификатор узла, а конфликт ключей видит
 * компилятор в точке композиции.
 */

/** Имя соединения, когда его не задали */
export const DEFAULT_CONNECTION = 'default';

/** Ключ переменной транзакции: `tx` или `<имя>Tx` */
export type TxKey<N extends string> = N extends typeof DEFAULT_CONNECTION
  ? 'tx'
  : `${N}Tx`;

/** Ключ поля контекста с сессией: ключ переменной плюс `Session` */
export type SessionKey<N extends string> = `${TxKey<N>}Session`;

/** Ключ переменной транзакции по имени экземпляра */
export const txKeyOf = (name: string): string =>
  name === DEFAULT_CONNECTION ? 'tx' : `${name}Tx`;

/** Ключ поля контекста, в котором слой держит сессию */
export const sessionKeyOf = (name: string): string => `${txKeyOf(name)}Session`;

/**
 * Идентификатор DI-токена соединения.
 *
 * Он же — имя проверки в пробах: вклад ресурса заводится под
 * идентификатором своего узла.
 */
export const tokenIdOf = (name: string): string =>
  name === DEFAULT_CONNECTION ? 'database' : `database:${name}`;

/** Имя плагина: имя пакета плюс имя экземпляра */
export const pluginNameOf = (name: string): string =>
  name === DEFAULT_CONNECTION
    ? '@nestlingjs/drizzle.pg'
    : `@nestlingjs/drizzle.pg:${name}`;
