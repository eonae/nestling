/**
 * Конструктор класса.
 *
 * @template T - Тип экземпляра, который создаёт конструктор
 */
export interface Constructor<T = any> {
  /** Конструктор */
  new (...args: any[]): T;
  /** Имя класса */
  name: string;
}

/**
 * Строка с привязанным типом `T`: позволяет ссылаться на тип в рантайме,
 * где самого типа уже нет.
 */
export type TokenString<T> = string & { __type: T };

/**
 * Токен: идентификатор зависимости в контейнере.
 *
 * Строковый токен (создаётся `makeToken`) или конструктор класса.
 *
 * @template T - Тип значения, которое стоит за токеном
 */
export type InjectionToken<T = unknown> = TokenString<T> | Constructor<T>;

/**
 * Превращает массив токенов в массив их типов.
 *
 * Так типизируются аргументы конструктора по списку `deps`.
 *
 * @template T - Массив токенов
 *
 * @example
 * ```typescript
 * // UnwrapInjectionTokens<[TokenString<string>, Constructor<SomeClass>]>
 * // равно [string, SomeClass]
 * ```
 */
export type UnwrapInjectionTokens<T extends InjectionToken[]> = {
  [K in keyof T]: T[K] extends TokenString<infer U>
    ? U
    : T[K] extends Constructor<infer V>
      ? V
      : never;
};

/**
 * Создаёт токен для интерфейса или другого типа, у которого нет класса.
 *
 * Токен — это переданная строка с привязанным типом `T`. Один и тот же
 * `id` всегда даёт один и тот же токен.
 *
 * @template T - Тип, который представляет токен
 * @param id - Уникальная строка
 * @returns Типизированный токен
 *
 * @example
 * ```typescript
 * interface ILogger {
 *   log(message: string): void;
 * }
 *
 * const ILogger = makeToken<ILogger>('ILogger');
 *
 * @Injectable(ILogger, [])
 * class ConsoleLogger implements ILogger {
 *   log(message: string) { console.log(message); }
 * }
 * ```
 */
export const makeToken = <T>(id: string): TokenString<T> =>
  id as TokenString<T>;

/**
 * Приводит токен к строковой форме.
 *
 * Строковый токен возвращается как есть; для класса токеном становится его
 * имя.
 *
 * @template T - Тип значения токена
 * @param token - Токен
 * @returns Строковый токен
 *
 * @example
 * ```typescript
 * const token1 = makeToken<ILogger>('ILogger');
 * stringifyToken(token1); // 'ILogger'
 *
 * class MyService {}
 * stringifyToken(MyService); // 'MyService'
 * ```
 */
export const stringifyToken = <T>(token: InjectionToken<T>): TokenString<T> =>
  typeof token === 'string' ? token : makeToken(token.name);
