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
 * Токен: объект, идентифицирующий зависимость в контейнере.
 *
 * Идентичность токена — ссылочная: два токена равны, только если это одно
 * значение. Поле `id` на равенство не влияет и служит отображению —
 * текстам ошибок, отчётам и `toJSON()` графа.
 *
 * @template T - Тип значения, которое стоит за токеном
 */
export interface Token<T = unknown> {
  /** Идентификатор для отчётов, ошибок и графа */
  readonly id: string;
  /**
   * Фантомное поле: несёт тип значения. В рантайме его нет — оно
   * существует, чтобы `Token<string>` и `Token<number>` не были
   * взаимозаменяемы.
   */
  readonly __type?: T;
}

/**
 * Токен: идентификатор зависимости в контейнере.
 *
 * Объектный токен (создаётся `makeToken`) или конструктор класса. Класс
 * тоже опознаётся по ссылке, а его имя — только для отображения.
 *
 * @template T - Тип значения, которое стоит за токеном
 */
export type InjectionToken<T = unknown> = Token<T> | Constructor<T>;

/**
 * Превращает массив токенов в массив их типов.
 *
 * Так типизируются аргументы конструктора по списку `deps`.
 *
 * @template T - Массив токенов
 *
 * @example
 * ```typescript
 * // UnwrapInjectionTokens<[Token<string>, Constructor<SomeClass>]>
 * // равно [string, SomeClass]
 * ```
 */
export type UnwrapInjectionTokens<T extends InjectionToken[]> = {
  [K in keyof T]: T[K] extends Constructor<infer V>
    ? V
    : T[K] extends Token<infer U>
      ? U
      : never;
};

/**
 * Создаёт токен для интерфейса или другого типа, у которого нет класса.
 *
 * Каждый вызов возвращает **новый** токен. Два вызова с одинаковым `id`
 * дают два разных токена: совпадение `id` сделает отчёты неоднозначными,
 * но подмены одной реализации другой не произойдёт. Токен объявляют один
 * раз и импортируют значением.
 *
 * @template T - Тип, который представляет токен
 * @param id - Идентификатор для отчётов и ошибок
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
export const makeToken = <T>(id: string): Token<T> =>
  Object.freeze({ id }) as Token<T>;

/**
 * Проверяет, что значение — объектный токен, а не класс и не что-то ещё.
 *
 * @param value - Проверяемое значение
 * @returns `true`, если это `Token`
 */
export const isToken = (value: unknown): value is Token =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Token).id === 'string';

/**
 * Возвращает идентификатор токена: строку для отчётов, ошибок и графа.
 *
 * Для класса это его имя. Идентификатор не заменяет токен: сравнивать
 * зависимости по нему нельзя, два разных токена могут его разделить.
 *
 * @template T - Тип значения токена
 * @param token - Токен
 * @returns Идентификатор
 *
 * @example
 * ```typescript
 * const ILogger = makeToken<ILogger>('ILogger');
 * tokenId(ILogger); // 'ILogger'
 *
 * class MyService {}
 * tokenId(MyService); // 'MyService'
 * ```
 */
export const tokenId = <T>(token: InjectionToken<T>): string =>
  typeof token === 'function' ? token.name : token.id;
