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
 * DI-токен: объект, идентифицирующий зависимость в контейнере.
 *
 * Идентичность DI-токена — ссылочная: два DI-токена равны, только если это одно
 * значение. Поле `id` на равенство не влияет и служит отображению —
 * текстам ошибок, отчётам и `toJSON()` графа.
 *
 * @template T - Тип значения, которое стоит за DI-токеном
 */
export interface Token<T = unknown> {
  /** Идентификатор для отчётов, ошибок и графа */
  readonly id: string;
  /** Текст починки на случай, когда провайдера для DI-токена нет */
  readonly hint?: string;
  /**
   * Фантомное поле: несёт тип значения. В рантайме его нет — оно
   * существует, чтобы `Token<string>` и `Token<number>` не были
   * взаимозаменяемы.
   */
  readonly __type?: T;
}

/**
 * Опции объявления DI-токена.
 *
 * @see {@link makeToken}
 */
export interface TokenOptions {
  /**
   * Текст починки на случай, когда провайдера для DI-токена нет.
   *
   * Печатается в ошибке сборки строкой под перечнем недостающих
   * зависимостей. Это починка, а не описание DI-токена: что за DI-токеном
   * стоит, читатель берёт из идентификатора и из типа.
   */
  readonly hint?: string;
}

/**
 * Класс как DI-токен.
 *
 * Публичного конструктора не требует: ресурс создаётся `static acquire`, и
 * его конструктор бывает приватным, — а DI-токеном остаётся тот же класс.
 * Класс опознаётся по ссылке; `prototype` несёт тип значения, `name` —
 * только для отображения.
 *
 * @template T - Тип экземпляра
 */
export interface ClassToken<T = unknown> {
  /** Прототип: несёт тип экземпляра */
  readonly prototype: T;
  /** Имя класса */
  readonly name: string;
}

/**
 * DI-токен: идентификатор зависимости в контейнере.
 *
 * Объектный DI-токен (создаётся `makeToken`) или класс. Класс тоже
 * опознаётся по ссылке, а его имя — только для отображения.
 *
 * @template T - Тип значения, которое стоит за DI-токеном
 */
export type InjectionToken<T = unknown> = Token<T> | ClassToken<T>;

/**
 * Превращает массив DI-токенов в массив их типов.
 *
 * Так типизируются аргументы конструктора по списку `deps`.
 *
 * @template T - Массив DI-токенов
 *
 * @example
 * ```typescript
 * // UnwrapInjectionTokens<[Token<string>, Constructor<SomeClass>]>
 * // равно [string, SomeClass]
 * ```
 */
export type UnwrapInjectionTokens<T extends InjectionToken[]> = {
  [K in keyof T]: T[K] extends ClassToken<infer V>
    ? V
    : T[K] extends Token<infer U>
      ? U
      : never;
};

/**
 * Создаёт DI-токен для интерфейса или другого типа, у которого нет класса.
 *
 * Каждый вызов возвращает **новый** DI-токен. Два вызова с одинаковым `id`
 * дают два разных DI-токена: совпадение `id` сделает отчёты неоднозначными,
 * но подмены одной реализации другой не произойдёт. DI-токен объявляют один
 * раз и импортируют значением.
 *
 * Опция `hint` — текст починки на случай, когда провайдера для DI-токена в
 * графе нет. Она печатается в ошибке сборки и не влияет на идентичность:
 * два DI-токена с одинаковым `id` и разными подсказками остаются разными.
 * Подсказка не заменяет описание — что за DI-токеном стоит, читатель берёт
 * из идентификатора и из типа.
 *
 * @template T - Тип, который представляет DI-токен
 * @param id - Идентификатор для отчётов и ошибок
 * @param options - Опции объявления: подсказка о починке
 * @returns Типизированный DI-токен
 *
 * @example
 * ```typescript
 * interface ILogger {
 *   log(message: string): void;
 * }
 *
 * const ILogger = makeToken<ILogger>('ILogger');
 *
 * @Component([])
 * class ConsoleLogger implements ILogger {
 *   log(message: string) { console.log(message); }
 * }
 *
 * // Регистрация под DI-токеном интерфейса — провайдером класса
 * classProvider(ILogger, ConsoleLogger);
 * ```
 *
 * @example
 * ```typescript
 * // Подсказка печатается, если провайдера шины в графе нет
 * const MessageBus$ = makeToken<IMessageBus>('MessageBus', {
 *   hint: "add a bus transport to 'transports:'",
 * });
 * ```
 */
export const makeToken = <T>(id: string, options?: TokenOptions): Token<T> =>
  Object.freeze(
    options?.hint === undefined ? { id } : { id, hint: options.hint },
  ) as Token<T>;

/**
 * Проверяет, что значение — объектный DI-токен, а не класс и не что-то ещё.
 *
 * @param value - Проверяемое значение
 * @returns `true`, если это `Token`
 */
export const isToken = (value: unknown): value is Token =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Token).id === 'string';

/**
 * Возвращает идентификатор DI-токена: строку для отчётов, ошибок и графа.
 *
 * Для класса это его имя. Идентификатор не заменяет DI-токен: сравнивать
 * зависимости по нему нельзя, два разных DI-токена могут его разделить.
 *
 * @template T - Тип значения DI-токена
 * @param token - DI-токен
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
  isToken(token) ? token.id : token.name;
